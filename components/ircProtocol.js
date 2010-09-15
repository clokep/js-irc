/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is the IRC-JavaScript.
 *
 * The Initial Developer of the Original Code is
 * Patrick Cloke <clokep@gmail.com>.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Parser based on code from ChatZilla (JSIRC Library)
 *     New Dimensions Consulting, Inc & Robert Ginda <rginda@ndcico.com> 1999
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

/*
 * See RFC protocols (http://www.irchelp.org/irchelp/rfc/)
 *   RFC1459 (original RFC; superseded) -- http://tools.ietf.org/html/rfc1459
 *   RFC2810 (IRC architecture) -- http://tools.ietf.org/html/rfc2810
 *   RFC2811 (IRC channel management) -- http://tools.ietf.org/html/rfc2811 <-- Mostly for servers
 *   RFC2812 (IRC client protocol) -- http://tools.ietf.org/html/rfc2812
 *   RFC2813 (IRC server protocol) -- http://tools.ietf.org/html/rfc2813 <-- Servers only
 *
 *   DCC specification -- http://www.irchelp.org/irchelp/rfc/dccspec.html
 *   CTCP specification -- http://www.irchelp.org/irchelp/rfc/ctcpspec.html
 *   Updated CTCP specification (not fully supported by clients) -- http://www.invlogic.com/irc/ctcp.html
 *
 *   ISupport (response code 005; supported by most servers) -- http://www.irc.org/tech_docs/draft-brocklesby-irc-isupport-03.txt
 */

// TODO Can we auto-detect character encoding?

var Cc = Components.classes;
var Ci = Components.interfaces;
var Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource:///modules/jsProtoHelper.jsm");

function dump(str) {
  Cc["@mozilla.org/consoleservice;1"]
    .getService(Ci.nsIConsoleService)
    .logStringMessage(str);
}

function Conversation(aAccount) {
  this._init(aAccount);
}
Conversation.prototype = {
  sendMsg: function(aMessage) {
    this.account._sendMessage(aMessage);
    this.writeMessage(this.account.name, aMessage, {outgoing: true});
  },
  get name() this.account._server
};
Conversation.prototype.__proto__ = GenericConversationPrototype;

function Account(aProtoInstance, aKey, aName) {
  this._init(aProtoInstance, aKey, aName);
}
Account.prototype = {
  _conv: null, // XXX Remove me eventually
  _conversations: {},
  _socketTransport: null,
  _inputStream: null,
  _outputStream: null,
  _scritableInputStream: null,
  _pump: null,
  //_server: "irc.mozilla.org",
  _server: "localhost",
  _port: 6667,
  _mode: 0x00, // bit 2 is 'w' (wallops) and bit 3 is 'i' (invisible)
  _realname: "clokep",

  // Data listener object
  onStartRequest: function(request, context) { },
  onStopRequest: function(request, context, status) { },
  onDataAvailable: function(request, context, inputStream, offset, count) {
    let data = this._scriptableInputStream.read(count).split(/\r\n/);
    for (var i = 0; i < data.length; i++)
      if (data[i].length) // Skip empty messages
        this._handleMessage(data[i]);
  },
  
  connect: function() {
    this.base.connecting();
    let self = this;
    this._conv = new Conversation(self); // XXX Remove me eventually
    this._conv.writeMessage(this._server, "You're now chatting on IRC!", {system: true});

    var socketTransportService = Cc["@mozilla.org/network/socket-transport-service;1"].getService(Ci.nsISocketTransportService);
    this._socketTransport = socketTransportService.createTransport(null, // Socket type
                                                                   0, // Length of socket types
                                                                   this._server, // Host
                                                                   this._port, // Port
                                                                   null); // Proxy info
    // Add a socketTransport listener so we can give better info to this.base.connecting()
    
    this._outputStream = this._socketTransport.openOutputStream(0, // flags
                                                                0, // Use default segment size
                                                                0); // Use default segment count
    this._inputStream = this._socketTransport.openInputStream(0, // flags
                                                              0, // Use default segment size
                                                              0); // Use default segment count

    this._scriptableInputStream = Cc["@mozilla.org/scriptableinputstream;1"]
                                    .createInstance(Ci.nsIScriptableInputStream);
    this._scriptableInputStream.init(this._inputStream);

    this._pump = Cc["@mozilla.org/network/input-stream-pump;1"]
                   .createInstance(Ci.nsIInputStreamPump);
    this._pump.init(this._inputStream, // Data to read
                    -1, // Current offset
                    -1, // Read all data
                    0, // Use default segment size
                    0, // Use default segment length
                    false); // Do not close when done
    this._pump.asyncRead(this, null);
    
    this._connnectionRegistration();

    this.base.connected();
  },
  
  disconnect: function() {
    this._outputStream.close();
    this._inputStream.close();
    this.socketTransport.close(Components.results.NS_OK);
  },
  
  /*
   * XXX flo wants to clean up this algorithm, it definitely can be done cleaner
   *   One regex to pull into the 3 or 4 parts and then .split(/ +/) the params
   * See section 2.3 of RFC 2812
   * 
   * parseMessage takes the message string and pulls useful information out. It
   * returns a message object which contains:
   *   source..........source of the message
   *   nickname........user's nickname
   *   user............user's username
   *   host............user's hostname
   *   command.........the command being implemented
   *   params..........list of parameters
   */
  _parseMessage: function(aData) {
    var aMessage = {};
    aMessage.rawMessage = aData;
  
    if (!aData.length) {
      dump("empty line on data");
      return aMessage;
    }
  
    if (aData[0] == ":") {
      // Must split only on spaces here, not any whitespace
      let temp = aData.match(/:([^ ]+) +(.*)/);
      aMessage.source = temp[1];
      aData = temp[2];
      if ((temp = aMessage.source.match(/([^ ]+)!([^ ]+)@(.*)/))) {
        aMessage.nickname = temp[1];
        aMessage.user = temp[2];
        aMessage.host = temp[3];
      } else if ((temp = aMessage.source.match(/([^ ]+)@(.*)/))) {
        aMessage.nickname = temp[1];
        aMessage.host = temp[2];
      } else if ((temp = aMessage.source.match(/([^ ]+)!(.*)/))) {
        aMessage.nickname = temp[1];
        aMessage.user = temp[2];
      }
    } else
      aMessage.source = this._server;
  
    var separator = aData.indexOf(" :");

    if (separator != -1) { // <trailing> param, if there is one
      var trail = aData.substr(separator + 2, aData.length);
      // Split other parameters by spaces
      aMessage.params = aData.substr(0,separator).split(/ +/);
      aMessage.params.push(trail);
    } else
      aMessage.params = aData.split(/ +/);
    
    // The first "parameter" is actually the command.
    if (aMessage.params.length)
      aMessage.command = aMessage.params.shift();
      
    aMessage.paramString = aData.substr(aMessage.command.length).trim();
  
    return aMessage;
  },
  
  _handleMessage: function(aRawMessage) {
    var aMessage = this._parseMessage(aRawMessage);
    dump(JSON.stringify(aMessage));
    if (!aMessage.source) // No real message
      return;
   
    // Handle command responses
    switch (aMessage.command.toUpperCase()) {
      case "ERROR":
        Cu.reportError(aMessage.rawMessage);
        dump(aMessage.rawMessage);
        break;
      case "NOTICE":
        this._conv.writeMessage(this._server,aMessage.paramString,{system: true});
        break;
      case "PING":
        // Keep the connection alive
        this._sendMessage("PONG :" + aMessage.params[0]);
        break;
      case "PRIVMSG":
        if (aMessage.params.length == 2) {
          var aConversation = this._getConversation(aMessage.params[0]);
          aConversation.writeMessage(aMessage.params[0],
                                     aMessage.params[1],
                                     {incoming: true});
        }
        break;
      // ERR_NONICKNAMEGIVEN
      // ERR_ERRONEUSNICKNAME
      // ERR_NICKNAMEINUSE
      // ERR_UNAVAILRESOURCE
      // ERR_NICKCOLLISION
      // ERR_RESTRICTED
      case "461": // ERR_NEEDMOREPARAMS
        //<command> :Not enough parameters
        Cu.reportError(aMessage.paramString);
        dump(aMessage.rawMessage);
      case "462": // ERR_ALREADYREGISTERED
        Cu.reportError(aMessage.paramString);
        dump(aMessage.rawMessage);
        break;
      // RPL_WELCOME -- we're authed
      default:
        // Output it for debug
        this._conv.writeMessage(this._server,aMessage.rawMessage,{incoming: true});
        break; // Do nothing
    }
  },
  
  /*
   * Returns a conversation (creates it if it doesn't exist)
   */
  _getConversation: function(aConversationName) {
    // Handle Scandanavian lower case
    aConversationName = aConversationName.toLowerCase()
                                         .replace('[','{')
                                         .replace(']','}')
                                         .replace('\\','|')
                                         .replace('~','^');
    if (!this._conversations[aConversationName])
      this._conversations[aConversationName] = new Conversation(this);
    return this._conversations[aConversationName];
  },
  
  _sendMessage: function(aMessage, aConversation) {
    aMessage += "\r\n";
    dump("Sending... " + aMessage);
    this._outputStream.write(aMessage, aMessage.length);
  },
  
  // Implement section 3.1 of RFC 2812
  _connnectionRegistration: function() {
    if (this.password) // Password message, if provided
      this._sendMessage("PASS " + this.password);
    this._sendMessage("NICK " + this.name); // Nick message
    this._sendMessage("USER " + this.name + " " + this._mode
                      + " * :" + this._realname); // User message
  }
};
Account.prototype.__proto__ = GenericAccountPrototype;

function IRCProtocol() { }
IRCProtocol.prototype = {
  get name() "IRC-JS",
  getAccount: function(aKey, aName) new Account(this, aKey, aName),
  classID: Components.ID("{607b2c0b-9504-483f-ad62-41de09238aec}")
};
IRCProtocol.prototype.__proto__ = GenericProtocolPrototype;

const NSGetFactory = XPCOMUtils.generateNSGetFactory([IRCProtocol]);

