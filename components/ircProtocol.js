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
 *   RFC2811 (IRC channel management) -- http://tools.ietf.org/html/rfc2811
 *     Mostly for servers
 *   RFC2812 (IRC client protocol) -- http://tools.ietf.org/html/rfc2812
 *   RFC2813 (IRC server protocol) -- http://tools.ietf.org/html/rfc2813
 *     Servers only
 *
 *   DCC specification -- http://www.irchelp.org/irchelp/rfc/dccspec.html
 *   CTCP specification -- http://www.irchelp.org/irchelp/rfc/ctcpspec.html
 *   Updated CTCP specification -- http://www.invlogic.com/irc/ctcp.html
 *     Not fully supported by clients
 *
 *   ISupport -- http://tools.ietf.org/html/draft-brocklesby-irc-isupport-03
 *     Response code 005; supported by most servers
 *   Updated ISupport -- http://tools.ietf.org/html/draft-hardy-irc-isupport-00
 */

var Cc = Components.classes;
var Ci = Components.interfaces;
var Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
//Cu.import("resource:///modules/jsProtoHelper.jsm");
Cu.import("resource://irc-js/jsProtoHelper.jsm"); // XXX Custom jsProtoHelper
Cu.import("resource://irc-js/ircParser.jsm"); // XXX Custom jsProtoHelper

function dump(str) {
  Cc["@mozilla.org/consoleservice;1"]
    .getService(Ci.nsIConsoleService)
    .logStringMessage(str);
}

// Handle Scandanavian lower case
// Optionally remove status indicators
function normalize(aStr, aRemoveStatus) {
  if (aRemoveStatus)
    aStr = aStr.replace(/^[@%\+]/, "");
  return aStr.toLowerCase().replace("[", "{").replace("]", "}")
                           .replace("\\", "|").replace("~", "^");
}

function Chat(aAccount, aName) {
  this._init(aAccount, aName);
}
Chat.prototype = {
  sendMsg: function(aMessage) {
    // Only send message if we're in the room
    // XXX is this the expected behavior?
    if (this._hasParticipant(this.account._nickname)) {
      this.account._sendMessage("PRIVMSG", [aMessage], this.name);
      this.writeMessage(this.account._nickname,
                        aMessage,
                        {outgoing: true});
    }
  },

  close: function() {
    this.account._sendMessage("PART", [this.name]);
    this.account._removeConversation(this.name);
  },

  setTopic: function(aTopic, aTopicSetter) {
    this._topic = aTopic;
    this._topicSetter = aTopicSetter;

    this.notifyObservers(null, "chat-update-topic");
  },

  _hasParticipant: function(aNick)
    this._participants.hasOwnProperty(normalize(aNick, true)),

  _getParticipant: function(aNick, aNotifyObservers) {
    let normalizedNick = normalize(aNick, true);
    if (!this._participants.hasOwnProperty(normalizedNick)) {
      this._participants[normalizedNick] = new ConvChatBuddy(aNick);

      if (aNotifyObservers) {
        this.notifyObservers(
          new nsSimpleEnumerator([this._participants[normalizedNick]]),
          "chat-buddy-add"
        );
      }
    }
    return this._participants[normalizedNick];
  },
  _removeParticipant: function(aNick) {
    let normalizedNick = normalize(aNick, true);
    if (this._participants.hasOwnProperty(normalizedNick)) {
      let stringNickname = Cc["@mozilla.org/supports-string;1"]
                              .createInstance(Ci.nsISupportsString);
      stringNickname.data = aNick;
      this.notifyObservers(new nsSimpleEnumerator([stringNickname]),
                           "chat-buddy-remove");
      delete this._participants[normalizedNick];
    }
  }
};
Chat.prototype.__proto__ = GenericConvChatPrototype;

function ConvChatBuddy(aName) {
  // XXX move this outside the function?
  const nameModes = {"@": "op", "%": "halfOp", "+": "voiced"};
  if (aName[0] in nameModes) {
    this[nameModes[aName[0]]] = true;
    aName = aName.slice(1)
  }
  this._name = aName;
}
ConvChatBuddy.prototype = {
  _setMode: function(aNewMode) {
    const modes = {"a": "away", // User is flagged as away
                   "i": "invisible", // Marks a user as invisible
                   "w": "wallop", // User receives wallops
                   "r": "restricted", // Restricted user connection
                   "o": "op", // Operator flag
                   "O": "lop", // Local operator flag
                   "s": "server"}; // User receives server notices
                   //XXX voice, channel creator? see 4.1 of RFC 2811

    // Are we going to add or remove the mode?
    let newMode = (aNewMode[0] == "+") ? true : false;

    // Check each mode being added and update the user
    for (let i = 1; i < aNewMode.length; i++) {
      if (aNewMode[i] in modes)
        this[modes[aNewMode[i]]] = newMode;
    }
  }
};
ConvChatBuddy.prototype.__proto__ = GenericConvChatBuddyPrototype;

function Conversation(aAccount, aName) {
  this._init(aAccount, aName);
}
Conversation.prototype = {
  sendMsg: function(aMessage) {
    this.account._sendMessage(aMessage);
    this.writeMessage(this.account._nickname,
                      aMessage,
                      {outgoing: true});
  },
  close: function() {
    this.account._removeConversation(this.name);
  }
};
Conversation.prototype.__proto__ = GenericConvIMPrototype;

function Account(aProtoInstance, aKey, aName) {
  this._init(aProtoInstance, aKey, aName);
  this._conversations = {};
  this._buddies = {};

  let matches = aName.split("@", 2); // XXX should this use the username split?
  this._nickname = matches[0];
  this._server = matches[1];

  // XXX load port, realname, etc. from preferences
  dump(this.getInt("port"));
  dump(this.getInt("port", 6667));
  //this._port = this.getInt("port");
  this._port = 6667;
  //this._realname = this.getString("realname");
  this._realname = "clokep";
  this._username = null;
  this._ssl = false;

  //this._port = 6697;
  //this._ssl = true;
}
Account.prototype = {
  _socketTransport: null,
  _inputStream: null,
  _outputStream: null,
  _scritableInputStream: null,
  _inputStreamBuffer: "",
  _pump: null,
  _mode: 0x00, // bit 2 is 'w' (wallops) and bit 3 is 'i' (invisible)

  canJoinChat: true,

  proxyInfo: new purpleProxyInfo(-1), // XXX make this reasonable

  // Data listener object
  onStartRequest: function(request, context) { },
  onStopRequest: function(request, context, status) { },
  onDataAvailable: function(request, context, inputStream, offset, count) {
    let data =
      this._inputStreamBuffer + this._scriptableInputStream.read(count);
    data = data.split(/\r\n/);

    // Store the (possible) incomplete part
    this._inputStreamBuffer = data.pop();

    for each (let message in data)
      this._handleMessage(message);
  },

  statusChanged: function(aStatusType, aMsg) {
    dump(aStatusType + "\r\n<" + aMsg + ">");
    if (aStatusType == Ci.purpleICoreService.STATUS_OFFLINE ||
        aStatusType == Ci.purpleICoreService.STATUS_UNAVAILABLE)
      this._sendMessage("AWAY", [aMsg || "I am away from my computer."]);
    else if (aStatusType == Ci.purpleICoreService.STATUS_AVAILABLE)
      this._sendMessage("AWAY");
  },

  connect: function() {
    this.base.connecting();

    var socketTS = Cc["@mozilla.org/network/socket-transport-service;1"]
                     .getService(Ci.nsISocketTransportService);
    this._socketTransport = socketTS.createTransport(this._ssl ? ["ssl"] : null, // Socket type
                                                     this._ssl? 1 : 0, // Length of socket types
                                                     this._server, // Host
                                                     this._port, // Port
                                                     null); // XXX Proxy info
    // XXX Add a socketTransport listener so we can give better info to this.base.connecting()

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

    this._connectionRegistration();
  },

  // When the user clicks "Disconnect" in account manager
  disconnect: function() {
    if (this.connected) {
      // Let the server know we're going to disconnect
      this.base.disconnecting(this._base.NO_ERROR, "Sending the QUIT message");
      this._sendMessage("QUIT"); // RFC 2812 Section 3.1.7
    } else {
      // We're not connected, just disconnect
      this._disconnect();
    }
  },

  createConversation: function(aName) {
    return this._getConversation(aName);
  },

  /*
   * aComponents implements purpleIChatRoomFieldValues
   */
  joinChat: function(aComponents) {
    this._getConversation(aComponents.getValue("channel"));
    // aComponents.getValue("password"); // XXX handle passwords here
  },

  getChatRoomFields: function() {
    let fields = [new ChatRoomField("_Channel",
                                    "channel",
                                    Ci.purpleIChatRoomField.TYPE_TEXT,
                                    true),
                  new ChatRoomField("_Password",
                                    "password",
                                    Ci.purpleIChatRoomField.TYPE_PASSWORD,
                                    false)];
    return new nsSimpleEnumerator(fields);
  },
  getChatRoomDefaultFieldValues: function(aDefaultChatName) {
    return new ChatRoomFieldValues();
  },

  // Attributes
  get canJoinChat() true,

  // Private functions
  /*
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
  // See http://joshualuckers.nl/2010/01/10/regular-expression-to-match-raw-irc-messages/
  _parseMessage: function(aData) {
    let message = {"rawMessage": aData};
    let temp;

    // Splits the raw string into four parts (the second is required)
    //   source
    //   command
    //   [parameter]
    //   [:last paramter]
    if ((temp = aData.match(/^(?:[:@]([^ ]+) )?([^ ]+)(?: ((?:[^: ][^ ]* ?)*))?(?: ?:(.*))?$/))) {
      // Assume message is from the server if not specified
      message.source = temp[1] || this._server;
      message.command = temp[2];
      // Space separated parameters
      message.params = temp[3] ? temp[3].trim().split(/ +/) : [];
      if (temp[4]) // Last parameter can contain spaces
        message.params.push(temp[4]);

      // The source string can be split into multiple parts as:
      //   :(server|nickname[[!user]@host]
      if ((temp = message.source.match(/([^ !@]+)(?:!([^ @]+))?(?:@([^ ]+))?/))) {
        message.nickname = temp[1];
        message.user = temp[2] || null; // Optional
        message.host = temp[3] || null; // Optional
      }
    }
    return message;
  },

  /*
   * Implement Section 5 of RFC 2812
   */
  // Remove aConversation blah blah
  _handleMessage: function(aRawMessage) {
    var message = this._parseMessage(aRawMessage);
    dump(JSON.stringify(message));
    if (!message.source) // No real message
      return;

    ircParser.parse(this, message);
  },

  _hasConversation: function(aConversationName)
    this._conversations.hasOwnProperty(normalize(aConversationName)),

  /*
   * Returns a conversation (creates it if it doesn't exist)
   */
  _getConversation: function(aConversationName) {
    // Handle Scandanavian lower case
    let normalizedName = normalize(aConversationName);
    if (!this._conversations.hasOwnProperty(normalizedName)) {
      let constructor = /^[&#+!]/.test(normalizedName) ? Chat : Conversation;
      this._conversations[normalizedName] =
        new constructor(this, aConversationName);
    }
    return this._conversations[normalizedName];
  },

  _removeConversation: function(aConversationName) {
    let normalizedName = normalize(aConversationName);
    if (this._conversations.hasOwnProperty(normalizedName))
      delete this._conversations[normalizedName];
  },

  _sendMessage: function(aCommand, aParams, aTarget) {
    let message = aCommand;
    if (aTarget)
      message += " " + aTarget;
    if (aParams && aParams.length) {
      // Join the parameters with spaces, except the last parameter which gets
      // joined with a " :" before it (and can contain spaces)
      let params = aParams.slice(0, -1);
      params.push(":" + aParams.slice(-1));
      message += " " + params.join(" ");
    }
    // XXX should check length of aMessage?
    message += "\r\n";
    dump("Sending... <" + message.trim() + ">");
    this._outputStream.write(message, message.length);
  },

  // Implement section 3.1 of RFC 2812
  _connectionRegistration: function() {
    if (this.password) // Password message, if provided
      this._sendMessage("PASS", [], this.password);
    this._sendMessage("NICK", [], this._nickname); // Nick message
    this._sendMessage("USER", [this._username || this._nickname,
                               this._mode, "*",
                               this._realname]); // User message
  },

  _disconnect: function() {
    // force QUIT and close the sockets
    this.base.disconnecting(this._base.NO_ERROR, "Closing sockets.");
    this._outputStream.close();
    this._inputStream.close();
    this._socketTransport.close(Components.results.NS_OK);

    this.base.disconnected();
  }
};
Account.prototype.__proto__ = GenericAccountPrototype;

function Protocol() { }
Protocol.prototype = {
  get name() "I R C",
  get iconBaseURI() "chrome://prpl-irc/skin/",
  get baseId() "prpl-irc",

  getUsernameSplit: function() {
    return new nsSimpleEnumerator([new UsernameSplit("Server",
                                                     "@",
                                                     "irc.freenode.com",
                                                     true)]);
  },

  // XXX need to refer to these in the above code
  options: [
    {name: "port", label: "Port", default: 6667},
    {name: "encoding", label: "Encodings", default: "UTF-8"},
    {name: "autodetect_utf8", label: "Auto-detect incoming UTF-8", default: false},
    {name: "username", label: "Username", default: ""},
    {name: "realname", label: "Real name", default: ""},
    //{name: "quitmsg", label: "Quit message", default: ""},
    {name: "ssl", label: "Use SSL", default: false},
    {name: "test", label: "Test", default: {"item one": "item 2", "ok": "OKKK"}}
  ],

  get chatHasTopic() true,

  getAccount: function(aKey, aName) new Account(this, aKey, aName),
  classID: Components.ID("{607b2c0b-9504-483f-ad62-41de09238aec}")
};
Protocol.prototype.__proto__ = GenericProtocolPrototype;

const NSGetFactory = XPCOMUtils.generateNSGetFactory([Protocol]);
