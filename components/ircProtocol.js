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

var Cc = Components.classes;
var Ci = Components.interfaces;
var Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
//Cu.import("resource:///modules/jsProtoHelper.jsm");
Cu.import("resource://irc-js/jsProtoHelper.jsm"); // XXX Custom jsProtoHelper
Cu.import("resource://irc-js/commands.jsm");
Cu.import("resource://irc-js/utils.jsm");

// Import specifications
Cu.import("resource://irc-js/irc.jsm");
Cu.import("resource://irc-js/ctcp.jsm");
var specifications = [ctcp, irc];

function Chat(aAccount, aName, aNick) {
  this._init(aAccount, aName, aNick);
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

  unInit: function() {
    this.account._sendMessage("PART", [this.name]);
    this.account._removeConversation(this.name);
  },

  setTopic: function(aTopic, aTopicSetter) {
    this._topic = aTopic || this._topic;
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
  },
  // Use this before joining to avoid errors of trying to re-add an existing
  // participant
  _removeAllParticipants: function() {
    let stringNicknames = [];
    for (let nickname in this._participants) {
      let stringNickname = Cc["@mozilla.org/supports-string;1"]
                              .createInstance(Ci.nsISupportsString);
      stringNickname.data = nickname;
      stringNicknames.push(stringNickname);
    }
    this.notifyObservers(new nsSimpleEnumerator(stringNicknames),
                         "chat-buddy-remove");
    this._participants = {};
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
                   "h": "halfOp", // Half operator flag
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
    this.account._sendMessage("PRIVMSG", [aMessage], this.name);
    this.writeMessage(this.account._nickname,
                      aMessage,
                      {outgoing: true});
  },
  unInit: function() {
    this.account._removeConversation(this.name);
  }
};
Conversation.prototype.__proto__ = GenericConvIMPrototype;

function Account(aProtoInstance, aKey, aName) {
  this._init(aProtoInstance, aKey, aName);
  this._conversations = {};
  this._buddies = {};

  ircAccounts[this.id] = this;

  let matches = aName.split("@", 2); // XXX should this use the username split?
  this._nickname = matches[0];
  this._server = matches[1];

  // Load preferences
  this._port = this.getInt("port");
  this._ssl = this.getBool("ssl");
  this._username = this.getString("username");
  this._realname = this.getString("realname");
}
Account.prototype = {
  _socket: null,
  _mode: 0x00, // bit 2 is 'w' (wallops) and bit 3 is 'i' (invisible)

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

    // Create a new socket for the connection
    this._socket = new Socket(this._server, this._port, this._ssl, null);
    this._socket.open();
    this._socket.read(/\r\n/, this._handleMessage, this); // Start reading

    this._connectionRegistration();
  },

  // When the user clicks "Disconnect" in account manager
  disconnect: function() {
    if (this.connected) {
      // Let the server know we're going to disconnect
      this.base.disconnecting(this._base.NO_ERROR, "Sending the QUIT message");
      let quitMessage = this.getString("quitmsg");
      this._sendMessage("QUIT", [quitMessage]); // RFC 2812 Section 3.1.7
    } else
      this._disconnect(); // We're not connected, just disconnect
  },

  createConversation: function(aName) this._getConversation(aName),

  /*
   * aComponents implements purpleIChatRoomFieldValues
   */
  joinChat: function(aComponents) {
    let params = [aComponents.getValue("channel")];
    if (aComponents.getValue("password"))
      params.push(aComponents.getValue("password"));
    this._sendMessage("JOIN", params)
  },

  chatRoomFields: {
    "channel": {"label": "_Channel", "required": true},
    "password": {"label": "_Password", "isPassword": true}
  },

  parseDefaultChatName: function(aDefaultChatName) {
    return {"channel": aDefaultChatName};
  },

  // Attributes
  get canJoinChat() true,

  // Private functions
  /*
   * Implement Section 5 of RFC 2812
   */
  // Remove aConversation blah blah
  _handleMessage: function(aRawMessage) {
    var message = ircParse.call(this, aRawMessage);

    // XXX For debug only
    dump(JSON.stringify(message));

    if (!message.source) // Not a real message
      return;

    let command = message.command.toUpperCase(),
        handled = false;

    // Loop over each specification set and call the command
    for (let i = 0; i < specifications.length; i++) {
      let spec = specifications[i];
      // If the command exists in the spec, execute it
      if (spec.hasOwnProperty(command))
        handled = spec[command].call(this, message);

      // Message was handled, cut out early
      if (handled)
        break;
    }

    // Nothing handled the message, throw an error
    if (!handled) {
      // XXX Output it for debug
      Cu.reportError("Unhandled message: " + aRawMessage);
      this._getConversation(message.source).writeMessage(
        message.source,
        message.rawMessage,
        {error: true}
      );
    }
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
      let constructor = isMUCName(normalizedName) ? Chat : Conversation;
      this._conversations[normalizedName] =
        new constructor(this, aConversationName, this._nickname);
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
    this._socket.write(message);
  },

  // Implement section 3.1 of RFC 2812
  _connectionRegistration: function() {
    if (this.password) // Password message, if provided
      this._sendMessage("PASS", [], this.password);
    this._sendMessage("NICK", [], this._nickname); // Nick message
    this._sendMessage("USER", [this._username || this._nickname, this._mode,
                               "*", this._realname || this._nickname]); // User message
  },

  _disconnect: function() {
    // force QUIT and close the sockets
    this.base.disconnecting(this._base.NO_ERROR, "Closing sockets.");

    this._socket.close();

    this.base.disconnected();
  }
};
Account.prototype.__proto__ = GenericAccountPrototype;

function Protocol() {
  this.registerCommands();
}
Protocol.prototype = {
  get name() "I R C",
  get iconBaseURI() "chrome://prpl-irc/skin/",
  get baseId() "prpl-irc",

  usernameSplits: [
    {label: "Server", separator: "@", defaultValue: "irc.freenode.com",
     reverse: true}
  ],

  options: {
    "port": {label: "Port", default: 6667},
    "ssl": {label: "Use SSL", default: false},
    "encoding": {label: "Encodings", default: "UTF-8"}, // XXX Unused
    "autodetect_utf8": {label: "Auto-detect incoming UTF-8", default: false}, // XXX Unused
    "username": {label: "Username", default: ""},
    "realname": {label: "Real name", default: ""},
    "quitmsg": {label: "Quit message", default: "Instantbird " +
                                                "<http://www.instantbird.org>"},
    "partmsg": {label: "Part message", default: ""} // XXX Unused
  },

  commands: commands,

  get chatHasTopic() true,

  getAccount: function(aKey, aName) new Account(this, aKey, aName),
  classID: Components.ID("{607b2c0b-9504-483f-ad62-41de09238aec}")
};
Protocol.prototype.__proto__ = GenericProtocolPrototype;

const NSGetFactory = XPCOMUtils.generateNSGetFactory([Protocol]);
