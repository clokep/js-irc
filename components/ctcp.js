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
 * The Original Code is the Instantbird messenging client, released 2011.
 *
 * The Initial Developer of the Original Code is
 * Patrick Cloke <clokep@gmail.com>.
 * Portions created by the Initial Developer are Copyright (C) 2011
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

const {classes: Cc, interfaces: Ci, results: Cr, utils: Cu} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://irc-js/jsProtoHelper.jsm");
Cu.import("resource://irc-js/utils.jsm");

function CTCPMessage(aMessage, aRawCTCPMessage) {
  this.rawCTCPMessage = aRawCTCPMessage;

  let dequotedCTCPMessage = aRawCTCPMessage.map(function(aMessage) {
    return this._highLevelDequote(this._lowLevelDequote(aMessage));
  }, this);

  // Create a new message type object for each one
  this.rawCTCPMessage = aRawCTCPMessage;
  let params = aString.split(" ");
  this.ctcpCommand = params.shift(); // Do not capitalize, case sensitive
  this.ctcpParam = params.join(" ");
}
CTCPMessage.prototype = {
  __proto__: ClassInfo("ircIMessage", "RFC 2812 Message - Basic IRC support"),
  classID:          Components.ID("{886bc073-d894-4bb7-abb3-686d837d3bc6}"),
  contractID:       "@instantbird.org/irc/rfc2812message;1",

  _lowLevelDequote: function(aString) {
    // Dequote (low level)
    // XXX do these need to be explicitly replaced?
    // Replace quote char (\020 == \x10) followed by 0, n, r or \020 (== \x10)
    // with the proper real character (see Low Level Quoting).
    return aString.replace(/\x100/g, "\0").replace(/\x10n/g, "\n")
                  .replace(/\x10r/g, "\r").replace(/\x10\x10/g, "\020");
  },
  _highLevelDequote: function(aString) {
    // Dequote (high level)
    // Replace quote char (\134 == \x5C) followed by a or \134 (\x5C) with \001
    // or \134.
    return aString.replace(/\x5Ca/g, "\001").replace(/\x5C\x5C/g, "\134");
  },

  format: 0,
  rawCTCPMessage: null,
  ctcpCommand: null,
  ctcpParam: null
}

// This is the ircISpecification for the IRC protocol, it will call each
// ircICTCPSpecification that is registered.
function ircCTCP() {
  [this._specifications, this._defaultSpec] =
    loadCategory("irc-ctcp-specification", "ircISpecification", "ctcp");
  // Sort the specifications by priority
  this._specifications = this._specifications
                             .sort(function(a, b) b.priority - a.priority);
}
ircCTCP.prototype = {
  __proto__: ClassInfo("ircISpecification", "CTCP"),
  classID:          Components.ID("{5eaf8911-cd4b-4d77-b7c2-abd0270e6bb4}"),
  contractID:       "@instantbird.org/irc/ctcp;1",

  // The CTCP specifications we'll enumerate.
  _specifications: [],
  _defaultSpecification: null,

  // Parameters
  name: "CTCP",
  // Slightly above default RFC 2812 priority
  priority: Ci.ircISpecification.PRIORITY_DEFAULT + 10,

  // aMessage here is an ircIMessage
  handle: function(aConv, aMessage) {
    // CTCP only uses PRIVMSG and NOTICE commands, just return if another
    // command is received.
    if (aMessage.command != "PRIVMSG" || aMessage.command != "NOTICE")
      return false;

    // The raw CTCP message is in the last parameter of the IRC message.
    let ctcpRawMessage;
    while (aMessage.params.hasMoreElements()) {
      ctcpRawMessage = aMessage.params.getNext()
                                      .QueryInterface(Ci.nsISupportsString);
    }

    // Split the raw message into the multiple CTCP messages and pull out the
    // command and parameters.
    var ctcpRawMessages = [];
    let temp;
    while ((temp = ctcpRawMessage.match(/^\x01([\w\W]*)\x01([\w\W])*$/))) {
      if (temp[0])
        ctcpMessage.push(new ctcpMessage(aMessage, temp[0]));
      ctcpRawMessage = temp[1];
    }

    // If no CTCP messages were found, return false.
    if (!ctcpRawMessage.length)
      return false;

    // Loop over each raw CTCP message
    for each (let ctcpRawMessage in ctcpRawMessage) {
      let ctcpMessage = new CTCPMessage(aMessage, ctcpRawMessage);

      handleMessage(aConv, this._specifications, ctcpMessage);
    }
    return true;
  }
}

// This is the ircISpecification for the base CTCP protocol.
function ctcp() { }
ctcp.prototype = {
  __proto__: ClassInfo("ircISpecification", "CTCP - Basic CTCP Support"),
  classID:          Components.ID("{b3f51abb-e280-438c-91f4-0ad1cbadb23c}"),
  contractID:       "@instantbird.org/irc/ctcp/ctcp;1",

  // Parameters
  name: "CTCP", // Name identifier
  priority: Ci.ircISpecification.PRIORITY_DEFAULT, // Default RFC 2812 priority

  parse: function _ctcpParseMessage(aData) new CTCPMessage(aData),
  __proto__: ClassInfo("ircISpecification", "CTCP"),
  classID:          Components.ID("{5eaf8911-cd4b-4d77-b7c2-abd0270e6bb4}"),
  contractID:       "@instantbird.org/irc/ctcp;1",

  // The CTCP specifications we'll enumerate.
  _specifications: [],
  _defaultSpecification: null,

  // Parameters
  name: "CTCP",
  // Slightly above default RFC 2812 priority
  priority: Ci.ircISpecification.PRIORITY_DEFAULT + 10,

  // Only the default IRC specification needs to parse messages, so we won't
  // implement our own parsing algorithm (we will need to parse, later on, the
  // CTCP message).
  parse: function(aRawMessage) {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },

  handle: function(aConv, aMessage) {
  }
}
/*
  // Make a nice JavaScript object for us to use (instead of the XPCOM
  // object).
  let message = {
    rawMessage: ctcpMessage.rawMessage,
    source: ctcpMessage.source,
    nickname: ctcpMessage.nickname,
    user: ctcpMessage.user,
    host: ctcpMessage.host,
    command: ctcpMessage.command,
    params: enumToArray(ctcpMessage.params),

    format: ctcpMessage.format,
    rawCTCPMessage: ctcpMessage.rawCTCPMessage,
    ctcpCommand: ctcpMessage.ctcpCommand,
    ctcpParam: ctcpMessage.ctcpParam
  };
  // Parse the command with the JavaScript conversation object as "this".
  this._ctcpCommands[command].call(ircAccounts[aConv.id], message);

{
  _ctcpCommands: {
    "ACTION": function(aMessage) {
      // ACTION <text>
      // Display message in conversation
      this._getConversation(isMUCName(aMessage.params[0]) ?
                              aMessage.params[0] : aMessage.nickname)
          .writeMessage(
            aMessage.nickname || aMessage.source,
            "/me " + aMessage.ctcpParam,
            {incoming: true}
          );
      return true;
    },

    // Used when an error needs to be replied with.
    "ERRMSG": function(aMessage) false,

    // Returns the user's full name, and idle time.
    "FINGER": function(aMessage) false,

    // Dynamic master index of what a client knows.
    "CLIENTINFO": function(aMessage) false,

    // Used to measure the delay of the IRC network between clients.
    "PING": function(aMessage) false,

    "SED": function(aMessage) false,

    // Where to obtain a copy of a client.
    "SOURCE": function(aMessage) false,

    // Gets the local date and time from other clients.
    "TIME": function(aMessage) false,

    // A string set by the user (never the client coder)
    "USERINFO": function(aMessage) false,

    // The version and type of the client.
    "VERSION": function(aMessage) false
  }
}*/

const NSGetFactory = XPCOMUtils.generateNSGetFactory([ircCTCP]);
