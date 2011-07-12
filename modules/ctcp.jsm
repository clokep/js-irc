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

var EXPORTED_SYMBOLS = ["ircCTCP", "ctcp"];

const {classes: Cc, interfaces: Ci, results: Cr, utils: Cu} = Components;

Cu.import("resource://irc-js/utils.jsm");

const VERSION = "Instantbird (JS-IRC)";

function lowLevelDequote(aString) {
  // Dequote (low level)
  // XXX do these need to be explicitly replaced?
  // Replace quote char (\020 == \x10) followed by 0, n, r or \020 (== \x10)
  // with the proper real character (see Low Level Quoting).
  return aString.replace(/\x100/g, "\0").replace(/\x10n/g, "\n")
                .replace(/\x10r/g, "\r").replace(/\x10\x10/g, "\020");
}
function highLevelDequote(aString) {
  // Dequote (high level)
  // Replace quote char (\134 == \x5C) followed by a or \134 (\x5C) with \001
  // or \134.
  return aString.replace(/\x5Ca/g, "\001").replace(/\x5C\x5C/g, "\134");
}

function CTCPMessage(aMessage, aRawCTCPMessage) {
  let message = aMessage;
  message.rawCTCPMessage = aRawCTCPMessage;

  let dequotedCTCPMessage = aRawCTCPMessage.map(function(aMessage) {
    return highLevelDequote(lowLevelDequote(aMessage));
  });

  let params = dequotedCTCPMessage.split(" ");
  message.ctcpCommand = params.shift(); // Do not capitalize, case sensitive
  message.ctcpParam = params.join(" ");
  return message;
}

// This is the ircISpecification for the IRC protocol, it will call each
// ircICTCPSpecification that is registered.
var ircCTCP = {
  // Parameters
  name: "CTCP",
  description: "CTCP",
  // Slightly above default RFC 2812 priority
  priority: 10,

  // aMessage here is an ircIMessage
  _handleCtcpMessage: function(aMessage) {
    // The raw CTCP message is in the last parameter of the IRC message.
    let ctcpRawMessage = aMessage.params.pop();

    // Split the raw message into the multiple CTCP messages and pull out the
    // command and parameters.
    var ctcpMessages = [];
    let temp;
    while ((temp = ctcpRawMessage.match(/^\x01([\w\W]*)\x01([\w\W])*$/))) {
      if (temp[0])
        ctcpMessages.push(new ctcpMessage(aMessage, temp[0]));
      ctcpRawMessage = temp[1];
    }

    // If no CTCP messages were found, return false.
    if (!ctcpMessages.length)
      return false;

    // Loop over each raw CTCP message
    for each (let message in ctcpMessages) {
      handleMessage(this, ctcpSpecifications, message, message.ctcpCommand);
    }
    return true;
  },

  // CTCP uses PRIVMSG and NOTICE commands, only handle those commands.
  commands: {
    "PRIVMSG": this._handleCtcpMessage,
    "NOTICE": this._handleCtcpMessage
  }
}

// This is the ircISpecification for the base CTCP protocol.
var ctcp = {
  // Parameters
  name: "CTCP",
  description: "CTCP",
  // Slightly above default RFC 2812 priority
  priority: 0,

  commands: {
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
    "VERSION": function(aMessage) {
      let conversation = this._getConversation(aMessage.nickname);

      if (aMessage.command == "PRIVMSG") {
        // VERSION
        // Received VERSION request, send VERSION response.
        conversation.writeMessage(aMessage.nickname,
                                  "Received VERSION request.", {system: true});
        conversation.writeMessage(aMessage.nickname,
                                  "Sending VERSION response: " + VERSION + ".",
                                  {system: true});
        this._sendCTCPMessage("VERSION", VERSION, aMessage.nickname, true);
      } else if (aMessage.command == "NOTICE" && aMessage.ctcpParam.length) {
        // VERSION #:#:#
        // Received VERSION response, display to the user.
        conversation.writeMessage(aMessage.nickname,
                                  "Received VERSION response: " +
                                    aMessage.ctcpParam + ".",
                                  {system: true});
      }
      return true;
    }
  }
}
