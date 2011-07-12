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
 * The Original Code is the Instantbird messenging client, released 2010.
 *
 * The Initial Developer of the Original Code is
 * Patrick Cloke <clokep@gmail.com>
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

var EXPORTED_SYMBOLS = ["normalize", "isMUCName", "ircAccounts", "enumToArray",
                        "loadCategory", "handleMessage", "DEBUG", "LOG", "WARN",
                        "ERROR", "registerCommands", "registerHandler",
                        "unregisterHandler", "ircHandlers"];

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource:///modules/imServices.jsm");
Cu.import("resource://irc-js/jsProtoHelper.jsm"); // XXX Custom jsProtoHelper
initLogModule("irc");

// Object to hold the IRC accounts by ID.
var ircAccounts = { };

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
var ircHandlers = { };
function registerHandler(aIrcHandler) {
  ircSpecifications[aIrcHandler.name] = aIrcHandler;
}
function unregisterHandler(aIrcHandlerName) {
  if (aIrcHandlerName in ircHandlers)
    delete ircHandlers[aIrcHandlerName];
}
/*
 * Object to hold the CTCP specifications, see above for the fields toimplement.
 */
var ctcpSpecifications = { };

// Handle Scandanavian lower case
// Optionally remove status indicators
function normalize(aStr, aRemoveStatus) {
  if (aRemoveStatus)
    aStr = aStr.replace(/^[@%\+]/, "");
  return aStr.toLowerCase().replace("[", "{").replace("]", "}")
                           .replace("\\", "|").replace("~", "^");
}

function isMUCName(aStr) {
  return /^[&#+!]/.test(normalize(aStr));
}

// This can be used to test is a string is a valid nickname string
function isNickName(aStr) {
  return /[A-Za-z\[\]\\`_^\{\|\}][A-Za-z0-9\-\[\]\\`_^\{\|\}]*/.test(normalize(aStr))
}

// Convert a nsISimpleEnumerator of nsISupportsString to a JavaScript array.
function enumToArray(aEnum) {
  let arr = [];
  while (aEnum.hasMoreElements())
    arr.push(aEnum.getNext().QueryInterface(Ci.nsISupportsString).data);
  return arr;
}

// Load all the registered components in a category and QI it to a specific
// interface.
function loadCategory(aCategory, aInterface) {
  let entries = [];

  // Get the category manager and enumerator for the category.
  let catManager = Cc["@mozilla.org/categorymanager;1"]
                     .getService(Ci.nsICategoryManager);
  let entryEnum = catManager.enumerateCategory(aCategory);
  while (entryEnum.hasMoreElements()) {
    // Get the category element names
    let entry = entryEnum.getNext().QueryInterface(Ci.nsISupportsCString);

    // Get the element and push it into our array
    let CID = catManager.getCategoryEntry(aCategory, entry);
    entries.push(Cc[CID].createInstance(Ci[aInterface]));
  }

  return entries;
}

// Handle a message based on a set of handlers.
function handleMessage(aConv, aHandlers, aMessage, aCommand) {
  let handled = false;

  ERROR(JSON.stringify(aHandlers));

  // Loop over each specification set and call the command
  for each (let handler in aHandlers) {
    // Attempt to execute the command, if the spec cannot handle it, it should
    // immediately return false.
    // Try block catches any funny business from the server here so the
    // component can keep executing.
    try {
      if (aCommand in handler.commands) {
        // Parse the command with the JavaScript conversation object as "this".
        handled = handler[aCommand].call(ircAccounts[aConv.id], aMessage);
      } else
        handled = false;
    } catch (e) {
      ERROR(e);
    }

    ERROR(aCommand);
    ERROR(JSON.stringify(aMessage));

    // Message was handled, cut out early
    if (handled)
      break;
  }

  // Nothing handled the message, throw an error
  if (!handled) {
    ERROR("Unhandled IRC message: " + aMessage.rawMessage);

    // XXX Output it in a conversation for debug
    ircAccounts[aConv.id]._getConversation(aMessage.source).writeMessage(
      aMessage.source,
      aMessage.rawMessage,
      {error: true}
    );
  }
}

function registerCommands(aCommands) {
  for each (let command in aCommands)
    Services.cmd.registerCommand(command, "prpl-irc");
}
