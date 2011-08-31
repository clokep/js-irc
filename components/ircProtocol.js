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

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource:///modules/imXPCOMUtils.jsm");
//Cu.import("resource:///modules/jsProtoHelper.jsm");
Cu.import("resource://irc-js/jsProtoHelper.jsm"); // XXX Custom jsProtoHelper
Cu.import("resource://irc-js/commands.jsm");
Cu.import("resource://irc-js/utils.jsm");
Cu.import("resource://irc-js/handlers.jsm");

Cu.import("resource://irc-js/socket.jsm"); // XXX custom socket

// Parses a raw IRC message into an ircIMessage (see section 2.3 of RFC 2812).
function rfc2812Message(aData) {
  LOG(aData);
  let message = {rawMessage: aData};
  let temp;

  // Splits the raw string into four parts (the second is required)
  //   source
  //   command
  //   [parameter]
  //   [:last paramter]
  // See http://joshualuckers.nl/2010/01/10/regular-expression-to-match-raw-irc-messages/
  // Should be equivalent to the slightly simplier:
  //   /^(?:[:@](\S+) )?(\S+)(?: ((?:[^: ]\S* ?)*))?(?: ?:(.*))?$/
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
    if (message.source &&
        (temp = message.source.match(/([^ !@]+)(?:!([^ @]+))?(?:@([^ ]+))?/))) {
      message.nickname = temp[1];
      message.user = temp[2] || null; // Optional
      message.host = temp[3] || null; // Optional
    }
  }

  return message;
}

function Chat(aAccount, aName, aNick) {
  this._init(aAccount, aName, aNick);
}
Chat.prototype = {
  __proto__: GenericConvChatPrototype,
  sendMsg: function(aMessage) {
    // Only send message if we're in the room
    // XXX is this the expected behavior?
    if (this._hasParticipant(this.account._nickname)) {
      this.account._sendMessage("PRIVMSG", [aMessage], this.name);
      this.writeMessage(this.account._nickname, aMessage, {outgoing: true});
    }
  },

  unInit: function() {
    if (this.account.connectionState == Ci.purpleIAccount.STATE_CONNECTED)
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
  _updateNick: function(aOldNick, aNewNick) {
    // Get the original ConvChatBuddy and then remove it
    let convChatBuddy = this._getParticipant(aOldNick);
    this._removeParticipant(aOldNick);

    // Update the nickname and add it under the new nick
    convChatBuddy._name = aNewNick;
    this._participants[normalize(aNewNick, true)] = convChatBuddy;

    this.notifyObservers(convChatBuddy, "chat-buddy-update", aOldNick);
  },
  _removeParticipant: function(aNick, aNotifyObservers) {
    if (this._hasParticipant(aNick)) {
      if (aNotifyObservers) {
        let stringNickname = Cc["@mozilla.org/supports-string;1"]
                                .createInstance(Ci.nsISupportsString);
        stringNickname.data = aNick;

        this.notifyObservers(new nsSimpleEnumerator([stringNickname]),
                             "chat-buddy-remove");
      }
      delete this._participants[normalize(aNick, true)];
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

function ConvChatBuddy(aName) {
  // XXX move this outside the function?
  const nameModes = {"@": "op", "%": "halfOp", "+": "voiced"};
  if (aName[0] in nameModes) {
    this[nameModes[aName[0]]] = true;
    aName = aName.slice(1);
  }
  this._name = aName;
}
ConvChatBuddy.prototype = {
  __proto__: GenericConvChatBuddyPrototype,
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

function Conversation(aAccount, aName) {
  this._init(aAccount, aName);
}
Conversation.prototype = {
  __proto__: GenericConvIMPrototype,
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

function ircSocket(aAccount) {
  // Implement Section 5 of RFC 2812
  this.onDataReceived = (function(aRawMessage) {
    let message = new rfc2812Message(aRawMessage);
    let handled =
      handleMessage(this, ircHandlers, message, message.command.toUpperCase());

    // Nothing handled the message, throw an error
    if (!handled) {
      ERROR("Unhandled IRC message: " + aRawMessage);

      // XXX Output it in a conversation for debug
      /*aAccount._getConversation(aMessage.source).writeMessage(
        aMessage.source,
        aMessage.rawMessage,
        {error: true}
      );*/
    }
  }).bind(aAccount);
  this.onConnection = aAccount._connectionRegistration.bind(aAccount);
  this.onConnectionReset = (function () {
    // Display the error in the account manager
    this.base.disconnecting(Ci.purpleIAccount.ERROR_NETWORK_ERROR,
                            "Connection reset.");
    this.base.disconnected(); // Start the reconnection timer
    this._socket.disconnect();
    Cu.reportError("Connection reset.");
  }).bind(aAccount);
}
ircSocket.prototype = {
  __proto__: Socket,
  delimiter: "\r\n",
  uriScheme: "irc://",
  connectTimeout: 60, // Failure to connect after 1 minute
  readWriteTimeout: 300, // Failure when no data for 5 minutes

  // Let's keep track of what's going on in the socket
  onConnectionTimedOut: function() { Cu.reportError("Timed out"); },
  onCertificationError: function(aSocketInfo, aStatus, aTargetSite) {
    Cu.reportError("Cert error");
  }
};

function Account(aProtoInstance, aKey, aName) {
  this._init(aProtoInstance, aKey, aName);
  this._conversations = {};
  this._buddies = {};

  // Store this account reference so we can get back to the IRC Account object.
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
  __proto__: GenericAccountPrototype,
  _socket: null,
  _mode: 0x00, // bit 2 is 'w' (wallops) and bit 3 is 'i' (invisible)

  statusChanged: function(aStatusType, aMsg) {
    LOG(aStatusType + "\r\n<" + aMsg + ">");
    if (aStatusType == Ci.purpleICoreService.STATUS_OFFLINE ||
        aStatusType == Ci.purpleICoreService.STATUS_UNAVAILABLE)
      this._sendMessage("AWAY", [aMsg || "I am away from my computer."]);
    else if (aStatusType == Ci.purpleICoreService.STATUS_AVAILABLE)
      this._sendMessage("AWAY");
  },

  connect: function() {
    this.base.connecting();

    // Remove the participants of all conversations so we don't get doubles
    Object.keys(this._conversations).forEach(function (aConvName) {
      this._getConversation(aConvName)._removeAllParticipants();
    }, this);

    // Open the socket connection
    this._socket = new ircSocket(this);
    this._socket.connect(this._server, this._port, this._ssl, null, false, "\r\n");
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
    this._sendMessage("JOIN", params);
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
    if (!aCommand) {
      ERROR("IRC messages must have a command.");
      return;
    }

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

    LOG("Sending... <" + message.trim() + ">");
    try {
      this._socket.sendData(message);
    } catch(e) {
      this._disconnect();
      this.base.disconnect(this._base.ERROR_NETWORK_ERROR,
                           "Socket closed unexpectedly.")
    }
  },

  _sendCTCPMessage: function(aCommand, aParams, aTarget, isNotice) {
    // Combine the CTCP command and parameters into the single IRC param.
    let params = aCommand;
    if (aParams.length)
      params += " " + aParams.join(" ");

    // Send the IRC message as a NOTICE or PRIVMSG.
    this._sendMessage(!!isNotice ? "NOTICE" : "PRIVMSG", params, aTarget);
  },

  // Implement section 3.1 of RFC 2812
  _connectionRegistration: function() {
    if (this.password) // Password message, if provided
      this._sendMessage("PASS", [], this.password);
    this._sendMessage("NICK", [], this._nickname); // Nick message
    this._sendMessage("USER", [this._username || this._nickname,
                               this._mode, "*",
                               this._realname || this._nickname]); // User message
  },

  _disconnect: function() {
    // force QUIT and close the sockets
    this.base.disconnecting(this._base.NO_ERROR, "Closing sockets.");

    this._socket.disconnect();

    this.base.disconnected();
  }
};

function Protocol() {
  this.registerCommands();

  // Register the standard handlers
  Cu.import("resource://irc-js/rfc2812.jsm");
  Cu.import("resource://irc-js/ctcp.jsm");

  // For IRC
  registerHandler(ircCTCP);
  registerHandler(rfc2812);
  // For CTCP
  registerCTCPHandler(ctcp);
}
Protocol.prototype = {
  __proto__: GenericProtocolPrototype,
  get name() "I R C",
  get iconBaseURI() "chrome://prpl-irc/skin/",
  get baseId() "prpl-irc",

  usernameSplits: [
    {label: "Server", separator: "@", defaultValue: "chat.freenode.net",
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

const NSGetFactory = XPCOMUtils.generateNSGetFactory([Protocol]);
