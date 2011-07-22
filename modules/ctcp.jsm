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
Cu.import("resource://irc-js/handlers.jsm");

const VERSION = "Instantbird (JS-IRC)";

function lowLevelDequote(aString) {
  // Dequote (low level) / Low Level Quoting
  // Replace quote char \020 followed by 0, n, r or \020 with the escaped
  // character.

  let unquoted = "";

  for (i = 0; i < aString.length; i++) {
    // Handle a normal character
    if (aString[i] != "\020") {
      unquoted += aString[i];
      continue;
    }

    // Look at the character after the escape char
    i++;

    if (aString[i] == "0") {
      // Replace with a null
      unquoted += "\0"
    } else if (aString[i] == "n") {
      // Replace with a line break
      unquoted += "\n"
    } else if (aString[i] == "r") {
      // Replace with a carriage return
      unquoted += "\r"
    } else if (aString[i] == "\020") {
      // Replace with the escape char
      unquoted += "\020";
    } else {
      // The quote char followed by any other character just gets removed.
      // XXX throw a warning
      unquoted += aString[i];
    }
  }

  return unquoted;
}

function highLevelDequote(aString) {
  // Dequote (high level) / CTCP Level Quoting
  // Replace quote char \134 followed by a or \134 with \001 or \134,
  // respectively.
  let unquoted = "";

  for (i = 0; i < aString.length; i++) {
    // Handle a normal character
    if (aString[i] != "\134") {
      unquoted += aString[i];
      continue;
    }

    // Look at the character after the escape char
    i++;

    if (aString[i] == "a") {
      unquoted += "\001";
    } else if (aString[i] == "\134") {
      unquoted += "\134"
    } else {
      // The quote char followed by any other character just gets removed.
      // XXX throw a warning
      unquoted += aString[i];
    }
  }
  return unquoted;
}

function CTCPMessage(aMessage, aRawCTCPMessage) {
  let message = aMessage;
  message.rawCTCPMessage = aRawCTCPMessage;

  let dequotedCTCPMessage = highLevelDequote(aRawCTCPMessage);

  let params = dequotedCTCPMessage.split(" ");
  message.ctcpCommand = params.shift(); // Do not capitalize, case sensitive
  message.ctcpParam = params.join(" ");
  return message;
}

var ctcpHandleMessage = function(aMessage) {
  if (ctcpHandlers == undefined)
    registerCTCPHandler(ctcp);

  // The raw CTCP message is in the last parameter of the IRC message.
  let ctcpRawMessage = lowLevelDequote(aMessage.params.slice(-1));

  // Split the raw message into the multiple CTCP messages and pull out the
  // command and parameters.
  var ctcpMessages = [];
  let temp;
  while ((temp = /^\x01([\w\W]*)\x01([\w\W])*$/.exec(ctcpRawMessage))) {
    if (temp[0])
      ctcpMessages.push(new CTCPMessage(aMessage, temp[1]));
    ctcpRawMessage = temp[2];
  }

  // If no CTCP messages were found, return false.
  if (!ctcpMessages.length)
    return false;

  let handled = true;

  // Loop over each raw CTCP message
  for each (let message in ctcpMessages) {
    Cu.reportError(JSON.stringify(message));
    handled &=
      handleMessage(this, ctcpHandlers, message, message.ctcpCommand);
  }

  return handled;
}

// This is the ircISpecification for the IRC protocol, it will call each
// ircICTCPSpecification that is registered.
var ircCTCP = {
  // Parameters
  name: "CTCP",
  description: "CTCP",
  // Slightly above default RFC 2812 priority
  priority: 10,

  // CTCP uses PRIVMSG and NOTICE commands, only handle those commands.
  commands: {
    "PRIVMSG": ctcpHandleMessage,
    "NOTICE": ctcpHandleMessage
  }
}

// This is the ircISpecification for the base CTCP protocol.
var ctcp = {
  // Parameters
  name: "CTCP",
  description: "CTCP",
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
    "PING": function(aMessage) {
      if (aMessage.command == "PRIVMSG") {
        // PING timestamp
        // Received PING request, send PING response.
        let consoleString = "Received PING request from " +
                            aMessage.nickname + ". Sending PING " +
                            "response: \"" + aMessage.ctcpParam + "\".";
        LOG(consoleString, {system: true});
        this._sendCTCPMessage("PING", aMessage.ctcpParam, aMessage.nickname,
                              true);
      } else {
        // PING timestamp
        // Received PING response, display to the user.
        let sentTime = new Date(aMessage.ctcpParam);

        // The received timestamp is invalid
        if (sentTime == "Invalid Date") {
          let consoleString = aMessage.nickname +
            " returned an invalid timestamp from a CTCP PING: " +
            aMessage.ctcpParam;
          WARN(consoleString);
          return false;
        }

        // Find the delay in seconds.
        let delay = (Date.now() - sentTime) / 1000;

        let response = "Received PING response. There is a delay of " + delay +
                       " to " + aMessage.nickname;
        this._getConversation(aMessage.nickname)
            .writeMessage(aMessage.nickname, response, {system: true});
      }
      return true;
    },

    "SED": function(aMessage) false,

    // Where to obtain a copy of a client.
    "SOURCE": function(aMessage) false,

    // Gets the local date and time from other clients.
    "TIME": function(aMessage) false,

    // A string set by the user (never the client coder)
    "USERINFO": function(aMessage) false,

    // The version and type of the client.
    "VERSION": function(aMessage) {
      if (aMessage.command == "PRIVMSG") {
        // VERSION
        // Received VERSION request, send VERSION response.
        let consoleString = "Received VERSION request from " +
                            aMessage.nickname + ". Sending VERSION " +
                            "response: \"" + VERSION + "\".";
        LOG(consoleString, {system: true});
        this._sendCTCPMessage("VERSION", VERSION, aMessage.nickname, true);
      } else if (aMessage.command == "NOTICE" && aMessage.ctcpParam.length) {
        // VERSION #:#:#
        // Received VERSION response, display to the user.
        let message = "Received VERSION response: " + aMessage.ctcpParam + ".";

        this._getConversation(aMessage.nickname)
            .writeMessage(aMessage.nickname, message, {system: true});
      }
      return true;
    }
  }
}
