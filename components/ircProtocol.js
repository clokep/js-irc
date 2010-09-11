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

/*
 * See RFC protocols (http://www.irchelp.org/irchelp/rfc/)
 *   RFC1459 (original RFC; superseded) -- http://tools.ietf.org/html/rfc1459
 *   RFC2810 (IRC architecture) -- http://tools.ietf.org/html/rfc2810
 *   RFC2811 (IRC channel management) -- http://tools.ietf.org/html/rfc2811
 *   RFC2812 (IRC client protocol) -- http://tools.ietf.org/html/rfc2812
 *   RFC2813 (IRC server protocol) -- http://tools.ietf.org/html/rfc2813
 *
 *   DCC specification -- http://www.irchelp.org/irchelp/rfc/dccspec.html
 *   CTCP specification -- http://www.irchelp.org/irchelp/rfc/ctcpspec.html
 *   Updated CTCP specification (not fully supported by clients) -- http://www.invlogic.com/irc/ctcp.html
 *
 *   ISupport (response code 005; supported by most servers) -- http://www.irc.org/tech_docs/draft-brocklesby-irc-isupport-03.txt
 */

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://app/modules/jsProtoHelper.jsm");

var Cc = Components.classes;
var Ci = Components.interfaces;

function dump(str) {
	Cc["@mozilla.org/consoleservice;1"]
		.getService(Ci.nsIConsoleService)
		.logStringMessage(str);
}

function Conversation(aAccount) {
	this._init(aAccount);
}
Conversation.prototype = {
	sendMsg: function(aMsg) {
		dump("Send");
		dump(aMsg);
		dump(this.account.outputStream.write(aMsg, aMsg.length));
		this.writeMessage("Me",aMsg,{outgoing: true});
		dump("Send end");
	},
	get name() "IRC"
};
Conversation.prototype.__proto__ = GenericConversationPrototype;

function Account(aProtoInstance, aKey, aName) {
	this._init(aProtoInstance, aKey, aName);
}
Account.prototype = {
	_conv: null,
	inputStream: null,
	outputStream: null,
	scritableInputStream: null,
	pump: null,
	onStartRequest: function(request, context) {
		dump("Start");
	},
	onStopRequest: function(request, context, status) {
		dump("Stop");
		this.outputStream.close();
		this.scriptableInputStream.close();
	},
	onDataAvailable: function(request, context, inputStream, offset, count) {
		dump("Data");
		let data = this.scriptableInputStream.read(count);
		dump(data);
		this._conv.writeMessage("IRC",data,{incoming: true});
		dump("Data end");
	},
	
	connect: function() {
		this.base.connecting();
		let self = this;
		this._conv = new Conversation(self);
		this._conv.writeMessage("IRC", "You're now chatting on IRC!", {system: true});

		var socketTransportService = Cc["@mozilla.org/network/socket-transport-service;1"].getService(Ci.nsISocketTransportService);
		this.socketTransport = socketTransportService.createTransport(null, // Socket type
																	 0, // Length of socket types
																	 //"irc.mozilla.org", // Host
																	 "localhost", // Host
																	 6667, // Port
																	 null); // Proxy info
		
		this.outputStream = this.socketTransport.openOutputStream(0, // flags
																  0, // Use default segment size
																  0); // Use default segment count
		this.inputStream = this.socketTransport.openInputStream(0,
																0, // Use default segment size
																0); // Use default segment count

		this.scriptableInputStream = Cc["@mozilla.org/scriptableinputstream;1"]
										.createInstance(Ci.nsIScriptableInputStream);
		this.scriptableInputStream.init(this.inputStream);

		this.pump = Cc["@mozilla.org/network/input-stream-pump;1"]
					  .createInstance(Ci.nsIInputStreamPump);
		this.pump.init(this.inputStream, // Data to read
					   -1, // Current offset
					   -1, // Read all data
					   0, // Use default segment size
					   0, // Use default segment length
					   false); // Do not close when done
		this.pump.asyncRead(this, null);

		this.base.connected();
	},
	
	disconnect: function() {
		this.outputStream.close();
		this.inputStream.close();
		this.socketTransport.close(Components.results.NS_OK);
	}
};
Account.prototype.__proto__ = GenericAccountPrototype;

function IRCProtocol() { }
IRCProtocol.prototype = {
	get name() "IRC-JS",
	getAccount: function(aKey, aName) new Account(this, aKey, aName),
	classID: Components.ID("{607b2c0b-9504-483f-ad62-41de09238aec}"),
};
IRCProtocol.prototype.__proto__ = GenericProtocolPrototype;

var NSGetModule = XPCOMUtils.generateNSGetModule([IRCProtocol]);
