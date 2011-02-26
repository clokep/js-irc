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

function ctcpParse(aMessage) {
  let rawMessage = aMessage.params.slice(-1);

  // XXX Split this into multiple messages if applicable
  let start = 0, end = 0;
  let ctcpStrings = [];
  while (start < rawMessage.length) {
    // Find the first and next marker
    start = rawMessage.indexOf("\001", start);
    end = rawMessage.indexOf("\001", start + 1);

    // Ignore the start and end markers when taking the slice
    if (start != -1 && end != -1) {
      ctcpStrings.push(rawMessage.slice(start + 1, end));
    }

    // Move past this point and look again
    start = end + 1;
  }

  // XXX do something w/ rawMessage

  ctcpStrings = ctcpStrings.map(function(aString) {
    // Dequote (low level)
    // XXX do these need to be explicitly replaced?
    // Replace quote char (\020) followed by 0, n, r or \020 with the proper
    // real character (see Low Level Quoting)
    let unquoted = rawMessage.replace(/\0200/g, "\0").replace(/\020n/g, "\n")
                             .replace(/\020r/g, "\r").replace(/\020\020/g, "\020");

    // Dequote (high level)
    // Replace quote char (\134) followed by a or \134 with \001 or \134
    return unquoted.replace(/\134a/g, /\001/).replace(/\134\134/g, "\134");
  });


  return ctcpStrings.map(function(aString) {
    return this.ctcpString = aString;
  }, aMessage);
}

var ctcp = {
  //
  "PRIVMSG": function (aMessage) {
    // Check if there's a CTCP message
    if (aMessage.params[1][0] == "\001") {
      let messages = ctcpParse(aMessage);
      return true;
    }
    return false;
  },
  //
  "NOTICE": function(aMessage) {
    return false;
  },

  "ACTION": function(aMessage) {
    Components.utils.reportError("HERE!");
  },

  "VERSION": function(aMessage) {
    return false;
  }
}
