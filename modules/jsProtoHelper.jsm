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
 * The Original Code is the Instantbird messenging client, released
 * 2010.
 *
 * The Initial Developer of the Original Code is
 * Florian QUEZE <florian@instantbird.org>.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Patrick Cloke <clokep@gmail.com>
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

var EXPORTED_SYMBOLS = [
  "setTimeout",
  "clearTimeout",
  "nsSimpleEnumerator",
  "EmptyEnumerator",
  "GenericAccountPrototype",
  "GenericAccountBuddyPrototype",
  "GenericConvIMPrototype",
  "GenericConvChatPrototype",
  "GenericConvChatBuddyPrototype",
  "ChatRoomField",
  "ChatRoomFieldValues",
  "UsernameSplit",
  "purpleProxyInfo",
  "GenericProtocolPrototype",
  "ForwardProtocolPrototype",
  "Message",
  "doXHRequest"
];

/*
 TODO
  replace doXHRequest with a more generic 'HTTP' object
*/

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource:///modules/imServices.jsm");

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;

function LOG(aString)
{
  Services.console.logStringMessage(aString);
}

function setTimeout(aFunction, aDelay)
{
  var timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
  var args = Array.prototype.slice.call(arguments, 2);
  timer.initWithCallback(function (aTimer) { aFunction.call(null, args); } ,
                         aDelay, Ci.nsITimer.TYPE_ONE_SHOT);
  return timer;
}
function clearTimeout(aTimer)
{
  aTimer.cancel();
}

/**
 * Constructs an nsISimpleEnumerator for the given array of items.
 * Copied from netwerk/test/httpserver/httpd.js
 *
 * @param items : Array
 *   the items, which must all implement nsISupports
 */
function nsSimpleEnumerator(items)
{
  this._items = items;
  this._nextIndex = 0;
}
nsSimpleEnumerator.prototype = {
  hasMoreElements: function() this._nextIndex < this._items.length,
  getNext: function() {
    if (!this.hasMoreElements())
      throw Cr.NS_ERROR_NOT_AVAILABLE;

    return this._items[this._nextIndex++];
  },
  QueryInterface: XPCOMUtils.generateQI([Ci.nsISimpleEnumerator])
};

const EmptyEnumerator = {
  hasMoreElements: function() false,
  getNext: function() { throw Cr.NS_ERROR_NOT_AVAILABLE; },
  QueryInterface: XPCOMUtils.generateQI([Ci.nsISimpleEnumerator])
};

XPCOMUtils.defineLazyGetter(this, "AccountBase", function()
  Components.Constructor("@instantbird.org/purple/account;1",
                         "purpleIAccountBase")
);

const GenericAccountPrototype = {
  _init: function _init(aProtoInstance, aKey, aName) {
    this._base = new AccountBase();
    this._base.concreteAccount = this;
    this._protocol = aProtoInstance;
    this._base.init(aKey, aName, aProtoInstance);

    Services.obs.addObserver(this, "status-changed", false);
  },
  get base() this._base.purpleIAccountBase,

  /*
   * aSubject is purpleICoreService
   * aTopic is "status-changed"
   * aData is <status text>
   */
  observe: function(aSubject, aTopic, aMsg) {
    let statusType = aSubject.currentStatusType;
    if (statusType == Ci.purpleICoreService.STATUS_OFFLINE)
      this.disconnect();
    else
      this.statusChanged(statusType, aMsg);
  },
  statusChanged: function(aStatusType, aMsg) {
    throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
  },

  checkAutoLogin: function() this._base.checkAutoLogin(),
  remove: function() this._base.remove(),
  UnInit: function() this._base.UnInit(),
  connect: function() this._base.connect(),
  disconnect: function() this._base.disconnect(),
  cancelReconnection: function() this._base.cancelReconnection(),
  createConversation: function(aName) this._base.createConversation(aName),
  addBuddy: function(aTag, aName) this._base.addBuddy(aTag, aName),
  loadBuddy: function(aBuddy, aTag) {
   try {
     return new AccountBuddy(this, aBuddy, aTag) ;
   } catch (x) {
     dump(x + "\n");
     return null;
   }
  },
  getChatRoomFields: function() this._base.getChatRoomFields(),
  getChatRoomDefaultFieldValues: function(aDefaultChatName)
    this._base.getChatRoomDefaultFieldValues(aDefaultChatName),
  joinChat: function(aComponents) this._base.joinChat(aComponents),
  setBool: function(aName, aVal) this._base.setBool(aName, aVal),
  setInt: function(aName, aVal) this._base.setInt(aName, aVal),
  setString: function(aName, aVal) this._base.setString(aName, aVal),
  getPref: function (aName, aType)
    this.prefs.prefHasUserValue(aName) ?
    this.prefs["get" + aType + "Pref"](aName) :
    this.protocol._getOptionDefault(aName),
  getInt: function(aName) this.getPref(aName, "Int"),
  getString: function(aName) this.getPref(aName, "Char"),
  getBool: function(aName) this.getPref(aName, "Bool"),
  save: function() this._base.save(),

  get prefs() this._prefs ||
    (this._prefs = Services.prefs.getBranch("messenger.account." + this.id +
                                             ".options.")),

  // grep attribute purpleIAccount.idl |sed 's/.* //;s/;//;s/\(.*\)/  get \1() this._base.\1,/'
  get canJoinChat() this._base.canJoinChat,
  get name() this._base.name,
  get normalizedName() this.name.toLowerCase(),
  get id() this._base.id,
  get numericId() this._base.numericId,
  get protocol() this._protocol,
  get autoLogin() this._base.autoLogin,
  get firstConnectionState() this._base.firstConnectionState,
  get password() this._base.password,
  get rememberPassword() this._base.rememberPassword,
  get alias() this._base.alias,
  get proxyInfo() this._base.proxyInfo,
  get connectionStateMsg() this._base.connectionStateMsg,
  get connectionErrorReason() this._base.connectionErrorReason,
  get reconnectAttempt() this._base.reconnectAttempt,
  get timeOfNextReconnect() this._base.timeOfNextReconnect,
  get timeOfLastConnect() this._base.timeOfLastConnect,
  get connectionErrorMessage() this._base.connectionErrorMessage,
  get connectionState() this._base.connectionState,
  get disconnected() this._base.disconnected,
  get connected() this._base.connected,
  get connecting() this._base.connecting,
  get disconnecting() this._base.disconnecting,
  get HTMLEnabled() this._base.HTMLEnabled,
  get noBackgroundColors() this._base.noBackgroundColors,
  get autoResponses() this._base.autoResponses,
  get singleFormatting() this._base.singleFormatting,
  get noNewlines() this._base.noNewlines,
  get noFontSizes() this._base.noFontSizes,
  get noUrlDesc() this._base.noUrlDesc,
  get noImages() this._base.noImages,

  // grep attribute purpleIAccount.idl |grep -v readonly |sed 's/.* //;s/;//;s/\(.*\)/  set \1(val) { this._base.\1 = val; },/'
  set autoLogin(val) { this._base.autoLogin = val; },
  set firstConnectionState(val) { this._base.firstConnectionState = val; },
  set password(val) { this._base.password = val; },
  set rememberPassword(val) { this._base.rememberPassword = val; },
  set alias(val) { this._base.alias = val; },
  set proxyInfo(val) { this._base.proxyInfo = val; },

  getInterfaces: function(countRef) {
    var interfaces = [Ci.nsIClassInfo, Ci.nsISupports, Ci.purpleIAccount];
    countRef.value = interfaces.length;
    return interfaces;
  },
  getHelperForLanguage: function(language) null,
  implementationLanguage: Ci.nsIProgrammingLanguage.JAVASCRIPT,
  flags: 0,
  QueryInterface: XPCOMUtils.generateQI([Ci.purpleIAccount, Ci.nsIClassInfo])
};


const GenericAccountBuddyPrototype = {
  _init: function(aAccount, aBuddy, aTag) {
    this._tag = aTag;
    this._account = aAccount;
    this._buddy = aBuddy;
  },

  get account() this._account,
  set buddy(aBuddy) {
    if (this._buddy)
      throw Components.results.NS_ERROR_ALREADY_INITIALIZED;
    this._buddy = aBuddy;
  },
  get buddy() this._buddy,
  get tag() this._tag,
  set tag(aNewTag) {
    let oldTag = this._tag;
    this._tag = aNewTag;
    Components.classes["@instantbird.org/purple/contacts-service;1"]
              .getService(Ci.imIContactsService)
              .accountBuddyMoved(this, oldTag, aNewTag);
  },

  _notifyObservers: function(aTopic, aData) {
    this._buddy.observe(this, "account-buddy-" + aTopic, aData);
  },

  get userName() this._buddy.userName, // FIXME
  get normalizedName() this._buddy.normalizedName, //FIXME
  _serverAlias: "",
  get serverAlias() this._serverAlias,
  set serverAlias(aNewAlias) {
    let old = this.displayName;
    this._serverAlias = aNewAlias;
    this._notifyObservers("display-name-changed", old);
  },

  remove: function() {
    Components.classes["@instantbird.org/purple/contacts-service;1"]
              .getService(Ci.imIContactsService)
              .accountBuddyRemoved(this);
  },

  // imIStatusInfo implementation
  get displayName() this.serverAlias || this.userName,
  _buddyIconFileName: "",
  get buddyIconFilename() this._buddyIconFileName,
  set buddyIconFilename(aNewFileName) {
    this._buddyIconFileName = aNewFileName;
    this._notifyObservers("icon-changed");
  },
  _statusType: 0,
  get statusType() this._statusType,
  get online() this._statusType > Ci.imIStatusInfo.STATUS_OFFLINE,
  get available() this._statusType == Ci.imIStatusInfo.STATUS_AVAILABLE,
  get idle() this._statusType == Ci.imIStatusInfo.STATUS_IDLE,
  get mobile() this._statusType == Ci.imIStatusInfo.STATUS_MOBILE,
  _statusText: "",
  get statusText() this._statusText,

  // This is for use by the protocol plugin, it's not exposed in the
  // imIStatusInfo interface.
  // All parameters are optional and will be ignored if they are null
  // or undefined.
  setStatus: function(aStatusType, aStatusText, aAvailabilityDetails) {
    // Ignore omitted parameters.
    if (aStatusType === undefined || aStatusType === null)
      aStatusType = this._statusType;
    if (aStatusText === undefined || aStatusText === null)
      aStatusText = this._statusText;
    if (aAvailabilityDetails === undefined || aAvailabilityDetails === null)
      aAvailabilityDetails = this._availabilityDetails;

    // Decide which notifications should be fired.
    let notifications = [];
    if (this._statusType != aStatusType ||
        this._availabilityDetails != aAvailabilityDetails)
      notifications.push("availability-changed");
    if (this._statusType != aStatusType ||
        this._statusText != aStatusText) {
      notifications.push("status-changed");
      if (this.online && aStatusType <= Ci.imIStatusInfo.STATUS_OFFLINE)
        notifications.push("signed-off");
      if (!this.online && aStatusType > Ci.imIStatusInfo.STATUS_OFFLINE)
        notifications.push("signed-on");
    }

    // Actually change the stored status.
    [this._statusType, this._statusText, this._availabilityDetails] =
      [aStatusType, aStatusText, aAvailabilityDetails];

    // Fire the notifications.
    notifications.forEach(function(aTopic) {
      this._notifyObservers(aTopic);
    }, this);
  },

  _availabilityDetails: 0,
  get availabilityDetails() this._availabilityDetails,

  get canSendMessage() this.online /*|| this.account.canSendOfflineMessage(this) */,

  getTooltipInfo: function() {
    throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
  },
  createConversation: function() {
    throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
  },

  getInterfaces: function(countRef) {
    var interfaces = [Ci.nsIClassInfo, Ci.nsISupports, Ci.imIAccountBuddy];
    countRef.value = interfaces.length;
    return interfaces;
  },
  getHelperForLanguage: function(language) null,
  implementationLanguage: Ci.nsIProgrammingLanguage.JAVASCRIPT,
  flags: 0,
  QueryInterface: XPCOMUtils.generateQI([Ci.imIAccountBuddy, Ci.nsIClassInfo])
};

function AccountBuddy(aAccount, aBuddy, aTag) {
  this._init(aAccount, aBuddy, aTag);
}
AccountBuddy.prototype = GenericAccountBuddyPrototype;


function Message(aWho, aMessage, aObject)
{
  this.id = ++Message.prototype._lastId;
  this.time = Math.round(new Date() / 1000);
  this.who = aWho;
  this.message = aMessage;
  this.originalMessage = aMessage;

  if (aObject)
    for (let i in aObject)
      this[i] = aObject[i];
}
Message.prototype = {
  _lastId: 0,

  QueryInterface: XPCOMUtils.generateQI([Ci.purpleIMessage, Ci.nsIClassInfo]),
  getInterfaces: function(countRef) {
    var interfaces = [
      Ci.nsIClassInfo, Ci.nsISupports, Ci.purpleIMessage
    ];
    countRef.value = interfaces.length;
    return interfaces;
  },
  getHelperForLanguage: function(language) null,
  contractID: null,
  classDescription: "Message object",
  classID: null,
  implementationLanguage: Ci.nsIProgrammingLanguage.JAVASCRIPT,
  flags: Ci.nsIClassInfo.DOM_OBJECT,

  get alias() this.who,
  _conversation: null,
  get conversation() this._conversation,
  set conversation(aConv) {
    this._conversation = aConv;
    aConv.notifyObservers(this, "new-text", null);
    Services.obs.notifyObservers(this, "new-text", null);
  },

  outgoing: false,
  incoming: false,
  system: false,
  autoResponse: false,
  containsNick: false,
  noLog: false,
  error: false,
  delayed: false,
  noFormat: false,
  containsImages: false,
  notification: false,
  noLinkification: false
};


const GenericConversationPrototype = {
  _lastId: 0,
  _init: function(aAccount, aName) {
    this.account = aAccount;
    this._name = aName;
    this.id = ++GenericConversationPrototype._lastId;

    this._observers = [];
    Services.obs.notifyObservers(this, "new-conversation", null);
  },

  getHelperForLanguage: function(language) null,
  contractID: null,
  classDescription: "Conversation object",
  classID: null,
  implementationLanguage: Ci.nsIProgrammingLanguage.JAVASCRIPT,
  flags: Ci.nsIClassInfo.DOM_OBJECT,

  addObserver: function(aObserver) {
    if (this._observers.indexOf(aObserver) == -1)
      this._observers.push(aObserver);
  },
  removeObserver: function(aObserver) {
    let index = this._observers.indexOf(aObserver);
    if (index != -1)
      this._observers.splice(index, 1);
  },
  notifyObservers: function(aSubject, aTopic, aData) {
    for each (let observer in this._observers)
      observer.observe(aSubject, aTopic, aData);
  },

  doCommand: function(aMsg) false,
  sendMsg: function (aMsg) {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },
  close: function() { },

  writeMessage: function(aWho, aText, aProperties) {
    // XXX use username split here? Do we care about aliases?
    if (aText.indexOf(this.account.name) != -1)
      aProperties.containsNick = true;
    (new Message(aWho, aText, aProperties)).conversation = this;
  },

  get name() this._name,
  get normalizedName() this.name.toLowerCase(),
  get title() this.name,
  account: null
};

const GenericConvIMPrototype = {
  QueryInterface: XPCOMUtils.generateQI([Ci.purpleIConversation,
                                         Ci.purpleIConvIM, Ci.nsIClassInfo]),
  getInterfaces: function(countRef) {
    var interfaces = [
      Ci.nsIClassInfo, Ci.nsISupports, Ci.purpleIConversation, Ci.purpleIConvIM
    ];
    countRef.value = interfaces.length;
    return interfaces;
  },
  classDescription: "ConvIM object",

  sendTyping: function(aLength) { },

  updateTyping: function(aState) {
    if (aState == this.typingState)
      return;

    if (aState == Ci.purpleIConvIM.NOT_TYPING)
      delete this.typingState;
    else
      this.typingState = aState;
    this.notifyObservers(null, "update-typing", null);
  },

  get isChat() false,
  buddy: null,
  typingState: Ci.purpleIConvIM.NOT_TYPING
};
GenericConvIMPrototype.__proto__ = GenericConversationPrototype;

const GenericConvChatPrototype = {
  _topic: null,
  _topicSetter: null,

  _init: function(aAccount, aName) {
    this._participants = {};
    GenericConversationPrototype._init.apply(this, arguments);
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.purpleIConversation,
                                         Ci.purpleIConvChat, Ci.nsIClassInfo]),
  getInterfaces: function(countRef) {
    var interfaces = [
      Ci.nsIClassInfo, Ci.nsISupports, Ci.purpleIConversation, Ci.purpleIConvChat
    ];
    countRef.value = interfaces.length;
    return interfaces;
  },
  classDescription: "ConvChat object",

  get isChat() true,
  get topic() this._topic,
  get topicSetter() this._topicSetter,
  get left() false,

  getParticipants: function() {
    return new nsSimpleEnumerator(
      Object.keys(this._participants)
            .map(function(key) this._participants[key], this)
    );
  }
};
GenericConvChatPrototype.__proto__ = GenericConversationPrototype;

const GenericConvChatBuddyPrototype = {
  get classDescription() "ConvChatBuddy object",
  get contractID() null,
  getInterfaces: function(countRef) {
    var interfaces = [Ci.nsIClassInfo, Ci.nsISupports, Ci.purpleIConvChatBuddy];
    countRef.value = interfaces.length;
    return interfaces;
  },
  getHelperForLanguage: function(language) null,
  implementationLanguage: Ci.nsIProgrammingLanguage.JAVASCRIPT,
  flags: 0,
  QueryInterface: XPCOMUtils.generateQI([Ci.purpleIConvChatBuddy,
                                         Ci.nsIClassInfo]),

  _name: "",
  get name() this._name,
  alias: "",
  buddy: false,

  get noFlags() !(this.voiced || this.halfOp || this.op ||
                  this.founder || this.typing),
  voiced: false,
  halfOp: false,
  op: false,
  founder: false,
  typing: false
};

function ChatRoomField(aLabel, aIdentifier, aType, aRequired, aMin, aMax) {
  this.label = aLabel;
  this.identifier = aIdentifier;
  this.type = aType;
  this.required = aRequired || false;

  this.min = aMin || 0;
  this.max = aMax || 1000; // XXX
}
ChatRoomField.prototype = {
  QueryInterface: XPCOMUtils.generateQI([Ci.purpleIChatRoomField,
                                         Ci.nsIClassInfo]),
  getInterfaces: function(countRef) {
    var interfaces = [Ci.nsIClassInfo, Ci.nsISupports, Ci.purpleIChatRoomField];
    countRef.value = interfaces.length;
    return interfaces;
  },
  getHelperForLanguage: function(language) null,
  contractID: null,
  classDescription: "ChatRoomField object",
  classID: null,
  implementationLanguage: Ci.nsIProgrammingLanguage.JAVASCRIPT,
  flags: 0
};

function ChatRoomFieldValues(aValue) {
  this._hash = {};
}
ChatRoomFieldValues.prototype = {
  QueryInterface: XPCOMUtils.generateQI([Ci.purpleIChatRoomFieldValues,
                                         Ci.nsIClassInfo]),
  getInterfaces: function(countRef) {
    var interfaces = [Ci.nsIClassInfo, Ci.nsISupports,
                      Ci.purpleIChatRoomFieldValues];
    countRef.value = interfaces.length;
    return interfaces;
  },
  getHelperForLanguage: function(language) null,
  contractID: null,
  classDescription: "ChatRoomFieldValues object",
  classID: null,
  implementationLanguage: Ci.nsIProgrammingLanguage.JAVASCRIPT,
  flags: 0,

  getValue: function(aIdentifier) {
    if (this._hash.hasOwnProperty(aIdentifier))
        return this._hash[aIdentifier];
    return null;
  },
  setValue: function(aIdentifier, aValue) {
    this._hash[aIdentifier] = aValue;
  }
};

function UsernameSplit(aLabel, aSeparator, aDefaultValue, aReverse) {
  this.label = aLabel;
  this.separator = aSeparator;
  this.defaultValue = aDefaultValue;
  this.reverse = !!aReverse; // Ensure boolean
}
UsernameSplit.prototype = {
  QueryInterface: XPCOMUtils.generateQI([Ci.purpleIUsernameSplit,
                                         Ci.nsIClassInfo]),
  getInterfaces: function(countRef) {
    var interfaces = [Ci.nsIClassInfo, Ci.nsISupports, Ci.purpleIUsernameSplit];
    countRef.value = interfaces.length;
    return interfaces;
  },
  getHelperForLanguage: function(language) null,
  contractID: null,
  classDescription: "Username Split object",
  classID: null,
  implementationLanguage: Ci.nsIProgrammingLanguage.JAVASCRIPT,
  flags: 0
};

function purplePref(aName, aLabel, aType, aDefaultValue, aMasked) {
  this.name = aName; // Preference name
  this.label = aLabel; // Text to display
  this.type = aType;
  this._defaultValue = aDefaultValue;
  this.masked = !!aMasked; // Obscured from view, ensure boolean
}
purplePref.prototype = {
  // Default value
  getBool: function() this._defaultValue,
  getInt: function() this._defaultValue,
  getString: function() this._defaultValue,
  getList: function()
    // Convert a JavaScript object map {"name1": "value1", "name2": "value2"}
    Object.keys(this._defaultValue).length ? new nsSimpleEnumerator(
      Object.keys(this._defaultValue)
            .map(function(key) new purpleKeyValuePair(key, this[key]),
                 this._defaultValue)
    ) : EmptyEnumerator,

  get classDescription() "Preference for Account Options",
  getInterfaces: function(countRef) {
    var interfaces = [Ci.nsIClassInfo, Ci.nsISupports, Ci.purpleIPref];
    countRef.value = interfaces.length;
    return interfaces;
  },
  getHelperForLanguage: function(language) null,
  implementationLanguage: Ci.nsIProgrammingLanguage.JAVASCRIPT,
  flags: 0,
  QueryInterface: XPCOMUtils.generateQI([Ci.purpleIPref, Ci.nsIClassInfo])
};

function purpleKeyValuePair(aName, aValue) {
  this.name = aName;
  this.value = aValue;
}
purpleKeyValuePair.prototype = {
  get classDescription() "Key Value Pair for Preferences",
  getInterfaces: function(countRef) {
    var interfaces = [Ci.nsIClassInfo, Ci.nsISupports, Ci.purpleIPref];
    countRef.value = interfaces.length;
    return interfaces;
  },
  getHelperForLanguage: function(language) null,
  implementationLanguage: Ci.nsIProgrammingLanguage.JAVASCRIPT,
  flags: 0,
  QueryInterface: XPCOMUtils.generateQI([Ci.purpleIPref, Ci.nsIClassInfo])
};

function purpleProxyInfo(type) {
  this.type = type;
}
purpleProxyInfo.prototype = {
  get useGlobal() -1,
  get noProxy() 0,
  get httpProxy() 1,
  get socks4Proxy() 2,
  get socks5Proxy() 3,
  get useEnvVar() 4,

  get classDescription() "Preference for Account Options",
  getInterfaces: function(countRef) {
    var interfaces = [Ci.nsIClassInfo, Ci.nsISupports, Ci.purpleIPref];
    countRef.value = interfaces.length;
    return interfaces;
  },
  getHelperForLanguage: function(language) null,
  implementationLanguage: Ci.nsIProgrammingLanguage.JAVASCRIPT,
  flags: 0,
  QueryInterface: XPCOMUtils.generateQI([Ci.purpleIPref, Ci.nsIClassInfo])
};
function purpleProxy(host, port, username, password) {
  this.host = host;
  this.port = port;
  this.username = username ? username : "";
  this.password = password ? password : "";
}
purpleProxy.prototype = purpleProxyInfo.prototype;

// the name getter needs to be implemented
const GenericProtocolPrototype = {
  get id() "prpl-" + this.normalizedName,
  get normalizedName() this.name.replace(/[^a-z0-0]/gi, "").toLowerCase(),
  get iconBaseURI() "chrome://instantbird/skin/prpl-generic/",

  getAccount: function(aKey, aName) { throw Cr.NS_ERROR_NOT_IMPLEMENTED; },

  _getOptionDefault: function(aName) {
    if (this.options && this.options.hasOwnProperty(aName))
      return this.options[aName].default;
    throw aName + " has no default value in " + this.id + ".";
  },
  getOptions: function() {
    if (!this.options)
      return EmptyEnumerator;

    const types = {boolean: "Bool", string: "String", number: "Int",
                   object: "List"};

    let purplePrefs = [];
    for (let optionName in this.options) {
      let option = this.options[optionName];
      if (!((typeof option.default) in types)) {
        throw "Invalid type for preference: " + optionName + ".";
        continue;
      }

      let type = Ci.purpleIPref["type" + types[typeof option.default]];
      purplePrefs.push(new purplePref(optionName,
                                      option.label,
                                      type,
                                      option.default,
                                      option.masked));
    }
    return new nsSimpleEnumerator(purplePrefs);
  },
  // NS_ERROR_XPC_JSOBJECT_HAS_NO_FUNCTION_NAMED errors are too noisy
  getUsernameSplit: function() EmptyEnumerator,
  get usernameEmptyText() "",
  accountExists: function() false, //FIXME

  get uniqueChatName() false,
  get chatHasTopic() false,
  get noPassword() false,
  get newMailNotification() false,
  get imagesInIM() false,
  get passwordOptional() true,
  get usePointSize() true,
  get registerNoScreenName() false,
  get slashCommandsNative() false,

  get classDescription() this.name + " Protocol",
  get contractID() "@instantbird.org/purple/" + this.normalizedName + ";1",
  getInterfaces: function(countRef) {
    var interfaces = [Ci.nsIClassInfo, Ci.nsISupports, Ci.purpleIProtocol];
    countRef.value = interfaces.length;
    return interfaces;
  },
  getHelperForLanguage: function(language) null,
  implementationLanguage: Ci.nsIProgrammingLanguage.JAVASCRIPT,
  flags: 0,
  QueryInterface: XPCOMUtils.generateQI([Ci.purpleIProtocol, Ci.nsIClassInfo])
};

// the baseId property should be set to the prpl id of the base protocol plugin
// and the name getter is required.
const ForwardProtocolPrototype = {
  get base() {
    if (!this.hasOwnProperty("_base")) {
      this._base =
        Cc["@instantbird.org/purple/core;1"].getService(Ci.purpleICoreService)
                                            .getProtocolById(this.baseId);

    }
    return this._base;
  },
  getAccount: function(aKey, aName) {
    let proto = this;
    let account = {
      _base: this.base.getAccount(aKey, aName),
      loadBuddy: function(aBuddy, aTag) this._base.loadBuddy(aBuddy, aTag),
      get normalizedName() this._base.normalizedName,
      get protocol() proto
    };
    account.__proto__ = GenericAccountPrototype;
    account._base.concreteAccount = account;
    return account;
  },

  get iconBaseURI() this.base.iconBaseURI,
  getOptions: function() this.base.getOptions(),
  getUsernameSplit: function() this.base.getUsernameSplit(),
  accountExists: function(aName) this.base.accountExists(aName),
  get uniqueChatName() this.base.uniqueChatName,
  get chatHasTopic() this.base.chatHasTopic,
  get noPassword() this.base.noPassword,
  get newMailNotification() this.base.newMailNotification,
  get imagesInIM() this.base.imagesInIM,
  get passwordOptional() this.base.passwordOptional,
  get usePointSize() this.base.usePointSize,
  get registerNoScreenName() this.base.registerNoScreenName,
  get slashCommandsNative() this.base.slashCommandsNative
};
ForwardProtocolPrototype.__proto__ = GenericProtocolPrototype;

function doXHRequest(aUrl, aHeaders, aPOSTData, aOnLoad, aOnError, aThis) {
  var xhr = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"]
                      .createInstance(Ci.nsIXMLHttpRequest);
  xhr.mozBackgroundRequest = true; // no error dialogs
  xhr.open("POST", aUrl);
  xhr.channel.loadFlags = Ci.nsIChannel.LOAD_ANONYMOUS; // don't send cookies
  xhr.onerror = function(aProgressEvent) {
    if (aOnError) {
      // adapted from toolkit/mozapps/extensions/nsBlocklistService.js
      let request = aProgressEvent.target;
      let status;
      try {
        // may throw (local file or timeout)
        status = request.status;
      }
      catch (e) {
        request = request.channel.QueryInterface(Ci.nsIRequest);
        status = request.status;
      }
      // When status is 0 we don't have a valid channel.
      let statusText = status ? request.statusText
                              : "nsIXMLHttpRequest channel unavailable";
      aOnError.call(aThis, statusText);
    }
  };
  xhr.onload = function (aRequest) {
    try {
      let target = aRequest.target;
      LOG("Received response: " + target.responseText);
      if (target.status != 200)
        throw target.status + " - " + target.statusText;
      if (aOnLoad)
        aOnLoad.call(aThis, aRequest.target.responseText);
    } catch (e) {
      Components.utils.reportError(e);
      if (aOnError)
        aOnError.call(aThis, e);
    }
  };

  if (aHeaders) {
    aHeaders.forEach(function(header) {
      xhr.setRequestHeader(header[0], header[1]);
    });
  }
  let POSTData =
    (aPOSTData || []).map(function(aParam) aParam[0] + "=" + encodeURI(aParam[1]))
                     .join("&");

  LOG("sending request to " + aUrl + " (POSTData = " + POSTData + ")");
  xhr.send(POSTData);
  return xhr;
}
