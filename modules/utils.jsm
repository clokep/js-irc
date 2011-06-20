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
                        "ERROR"];

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource:///modules/imServices.jsm");
Cu.import("resource://irc-js/jsProtoHelper.jsm"); // XXX Custom jsProtoHelper
initLogModule("irc");

// Object to hold the IRC accounts by ID.
var ircAccounts = { };

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

// Convert a nsISimpleEnumerator of nsISupportsString to a JavaScript array.
function enumToArray(aEnum) {
  let arr = [];
  while (aEnum.hasMoreElements())
    arr[arr.length] = aEnum.getNext().QueryInterface(Ci.nsISupportsString).data;
  return arr;
}

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

function handleMessage(aConv, aSpecifications, aMessage) {
  let handled = false;

  // Loop over each specification set and call the command
  for each (let spec in aSpecifications) {
    // Attempt to execute the command, if the spec cannot handle it, it should
    // immediately return false.
    // Try block catches any funny business from the server here so the
    // component can keep executing.
    try {
      handled = spec.handle(aConv, aMessage);
    } catch (e) {
      ERROR(e);
    }

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
