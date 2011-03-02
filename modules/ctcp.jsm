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

var EXPORTED_SYMBOLS = ["ctcp"];

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://irc-js/utils.jsm");

function ctcpParse(aMessage) {
  // CTCP messages are in the last param of the IRC message
  var rawMessage = aMessage.params.slice(-1)[0];

  // XXX Split this into multiple messages if applicable
  var start = 0, end;
  var ctcpStrings = [];
  while (start < rawMessage.length) {
    // Find the first and next marker
    start = rawMessage.indexOf("\001", start);
    end = rawMessage.indexOf("\001", start + 1);

    // Ignore the start and end markers when taking the slice
    if (start != -1 && end != -1) {
      ctcpStrings.push(rawMessage.slice(start + 1, end));
    } else
      break;

    // Move past this point and look again
    start = end + 1;
    break; // XXX debug
  }

  // XXX do something w/ the leftover rawMessage

  ctcpStrings = ctcpStrings.map(function(aString) {
    // Dequote (low level)
    // XXX do these need to be explicitly replaced?
    // Replace quote char (\020) followed by 0, n, r or \020 with the proper
    // real character (see Low Level Quoting)
    var unquoted = aString.replace(/\0200/g, "\0").replace(/\020n/g, "\n")
                          .replace(/\020r/g, "\r").replace(/\020\020/g, "\020");

    // Dequote (high level)
    // Replace quote char (\134) followed by a or \134 with \001 or \134
    return unquoted.replace(/\134a/g, "\001").replace(/\134\134/g, "\134");
  });

  // Create a new message type object for each one
  return ctcpStrings.map(function(aString) {
    this.rawCtcpMessage = aString;
    var params = aString.split(" ")
    this.ctcpType = params.shift(); // Do not capitalize, case sensitive
    this.ctcpParam = params.join(" ");
    return this;
  }, aMessage);
}

var ctcp = {
  //
  "PRIVMSG": function (aMessage) {
    // Check if there's a CTCP message
    if (aMessage.params[1][0] == "\001") {
      let messages = ctcpParse.call(this, aMessage);
      messages.forEach(function(aMessage) {
        dump(JSON.stringify(aMessage));
        if (_ctcp.hasOwnProperty(aMessage.ctcpType))
          return _ctcp[aMessage.ctcpType].call(this, aMessage);
        // XXX Throw an error (reply w/ NOTICE ERRMSG)
        return false;
      }, this);
      return true;
    }
    return false;
  },
  //
  "NOTICE": function(aMessage) {
    return false;
  }
}

var _ctcp = {
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

  "DCC": function(aMessage) false,

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
  "VERSION": function(aMessage) false,

  "XDCC": function(aMessage) false
}

var _dcc = {
  "ACCEPT": function(aMessage) false,

  //"BDCC": function(aMessage) false, // ??? Bitorrent DCC?

  // XXX Also CHAT wboard for whiteboard
  "CHAT": function(aMessage) false,

  "GET": function(aMessage) false,

  "FILE": function(aMessage) false,

  "OFFER": function(aMessage) false,

  "RESUME": function(aMessage) false,

  "REVERSE": function(aMessage) false,

  "RSEND": function(aMessage) false,

  "SEND": function(aMessage) false,

  "TALK": function(aMessage) false,

  "TGET": function(aMessage) false,

  "TSEND": function(aMessage) false,

  "XMIT": function(aMessage) false,
}

var _xdcc = {
  "LIST": function(aMessage) false,
  "SEND": function(aMessage) false
}
