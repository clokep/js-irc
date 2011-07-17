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
 * Patrick Cloke <clokep@gmail.com>
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

var EXPORTED_SYMBOLS = ["registerHandler", "unregisterHandler", "ircHandlers",
                        "handleMessage"];

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://irc-js/utils.jsm");

Cu.import("resource://irc-js/rfc2812.jsm");
Cu.import("resource://irc-js/ctcp.jsm");
//Cu.import("resource://irc-js/dcc.jsm");
//Cu.import("resource://irc-js/xdcc.jsm");

/*
 * Object to hold the IRC handler, each handler is an object that implements:
 *   name      The display name of the specification.
 *   priority  The priority of the specification (0 is default, positive is
 *             higher priority)
 *   commands  An object of commands, each command is a function which accepts a
 *             message object and has 'this' bound to the account object. It
 *             should return whether the message was successfully handler or
 *             not.
 */
var ircHandlers = [ircCTCP, rfc2812];
function registerHandler(aIrcHandler) {
  ircHandlers.push(aIrcHandler);
  ircHandlers.sort(function(a, b) b.priority - a.priority);
}
/*function unregisterHandler(aIrcHandlerName) {
}*/

/*
 * Object to hold the CTCP specifications, see above for the fields toimplement.
 */
var ctcpSpecifications = [];

// Handle a message based on a set of handlers.
// 'this' is the JS account object.
function handleMessage(aAccount, aHandlers, aMessage, aCommand) {
  let handled = false;

  // Loop over each specification set and call the command
  for each (let handler in aHandlers) {
    // Attempt to execute the command, if the spec cannot handle it, it should
    // immediately return false.
    // Try block catches any funny business from the server here so the
    // component can keep executing.
    try {
      // Parse the command with the JavaScript conversation object as "this".
      if (aCommand in handler.commands)
        handled = handler.commands[aCommand].call(aAccount, aMessage);
    } catch (e) {
      ERROR(JSON.stringify(aMessage));
      ERROR(e);
    }

    // Message was handled, cut out early
    if (handled) {
      LOG(JSON.stringify(aMessage));
      break;
    }
  }

  return handled;
}
