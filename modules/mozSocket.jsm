/*
The contents of this file are subject to the Mozilla Public
License Version 1.1 (the "License"); you may not use this file
except in compliance with the License. You may obtain a copy of
the License at http://www.mozilla.org/MPL/

Software distributed under the License is distributed on an "AS
IS" basis, WITHOUT WARRANTY OF ANY KIND, either express or
implied. See the License for the specific language governing
rights and limitations under the License.

The Original Code is JSIRC Library

The Initial Developer of the Original Code is New Dimensions Consulting, Inc.

Portions created by the Initial Developer are Copyright (C) 1999
the Initial Developer. All Rights Reserved.

Contributor(s):
  Robert Ginda, rginda@ndcico.com, original author
  Peter Van der Beken, peter.vanderbeken@pandora.be, necko-only version
  Stephen Clavering <mozilla@clav.me.uk>, extensively rewritten for MSNMessenger
*/

// Represents a connection to a Dispatch Server, Notification Server, or Switchboard.
// High-level interface for use by ClientConnection and MSNSession is:
//     .connect(host, port)
//     .disconnect()
//     .sendMsg(msg, body)
//       msg: an array of strings, which will be joined with " " chars
//       body: an optional "payload" for the message.  If present, it's length
//         will be appended to the msg array
//     .isConnected [boolean field]
//     (Also nsIStreamListener, and thus nsIRequestObserver, for internal use.)
// Users should "subclass" this object, i.e. set their .__proto__ to be it.
// Then implement:
//     onProtocolMessageReceived(msg, payload)
//       msg: an array of string tokens (which were space-separated)
//       payload: a string blob, or null (depending on message type)
// And optionally:
//    onConnectionTimedOut()

const BaseConnection = {
  isConnected: false,
  binaryMode: false,

  // Commands which *when received by us* have a payload: a multi-line blob of
  // data whose length is given by the last element of the command.  This list
  // must not include commands like QRY, which have a payload when sent by us,
  // but are acknowledged with just a TrID.
  _payloadCommands: { "NOT": true, "MSG": true },

  _data: "", // incoming data buffer.  character encoding is unknown

  _timeout: null, // return value of setTimeout

  // Synchronously open a connection.
  connect: function(host, port) {
    this._log("<o> Connecting to: " + host + ":" + port);
    this.host = host.toLowerCase();
    this.port = port;
    this._data = "";
    this.isConnected = true;

    const sts = Components.classes["@mozilla.org/network/socket-transport-service;1"].getService(Components.interfaces.nsISocketTransportService);
    this.transport = sts.createTransport(null, 0, host, port, null);
    // no limit on the output stream buffer
    this._outputStream = this.transport.openOutputStream(0, 4096, -1);
    if(!this._outputStream) throw "Error getting output stream.";
    this._inputStream = this.transport.openInputStream(0, 0, 0);
    if(!this._inputStream) throw "Error getting input stream.";
    const bis = Components.classes["@mozilla.org/binaryinputstream;1"].createInstance(Components.interfaces.nsIBinaryInputStream);
    bis.setInputStream(this._inputStream);
    this._binaryInputStream = bis;
    const pump = Components.classes["@mozilla.org/network/input-stream-pump;1"].createInstance(Components.interfaces.nsIInputStreamPump);
    pump.init(this._inputStream, -1, -1, 0, 0, false);
    pump.asyncRead(this, this);
  },

  listen: function(port) {
    this._log("<o> Listening on port " + port);
    const sSC = Components.classes["@mozilla.org/network/server-socket;1"];
    if (!sSC) throw("Could not get server socket class.");
    const serverSock = sSC.createInstance();
    if (!serverSock) throw("Could not get server socket.");
    this.serverSock = serverSock.QueryInterface(Components.interfaces.nsIServerSocket);
    this.serverSock.init(port, false, -1);
    this.serverSock.asyncListen(this);
  },

  onSocketAccepted: function(socket, transport) {
    this._log("<o> onSocketAccepted");
    this.transport = transport;
    this.host = this.transport.host.toLowerCase();
    this.port = this.transport.port;
    this._data = "";
    this.isConnected = true;

    // no limit on the output stream buffer
    this._outputStream = this.transport.openOutputStream(0, 4096, -1);
    if(!this._outputStream) throw "Error getting output stream.";
    this._inputStream = this.transport.openInputStream(0, 0, 0);
    if(!this._inputStream) throw "Error getting input stream.";
    const bis = Components.classes["@mozilla.org/binaryinputstream;1"].createInstance(Components.interfaces.nsIBinaryInputStream);
    bis.setInputStream(this._inputStream);
    this._binaryInputStream = bis;
    const pump = Components.classes["@mozilla.org/network/input-stream-pump;1"].createInstance(Components.interfaces.nsIInputStreamPump);
    pump.init(this._inputStream, -1, -1, 0, 0, false);
    pump.asyncRead(this, this);
    this.onConnectionHeard();
    this.stopListening();
  },

  disconnect: function() {
    this._log(">o< Disconnect");
    if(this._inputStream) this._inputStream.close();
    if(this._outputStream) this._outputStream.close();
    this.isConnected = false;
  },

  stopListening: function() {
    this._log(">o< Stop listening");
    if(this.serverSock) this.serverSock.close();
  },

  // Methods for subtypes to override
  onConnectionHeard: function() {
  },
  onConnectionTimedOut: function() {
  },
  onConnectionReset: function() {
  },
  onProtocolMessageReceived: function(msg, payload) {
  },
  onBinaryDataReceived: function(binData, binDataLength) {
  },

  // Convenience function for sending protocol-level messages in the usual MSN format.
  sendMsg: function(items, payload) {
    if(payload) items.push(payload.length);
    this.sendData(items.join(" ") + "\r\n" + (payload || ''));
  },

  // Low-level
  sendData: function(str, timeout) {
    this._logMsg('>>> ', '.>. ', str);
    try {
      this._outputStream.write(str, str.length);
      if(timeout) {
        if(this._timeout) clearTimeout(this._timeout);
        this._timeout = setTimeout(onTimeOutHelper, timeout, this); // i.e. onTimeOutHelper(this)
      }
    } catch(e) {
      this.isConnected = false;
    }
  },

  // nsIStreamListener::onDataAvailable, called by Mozilla's networking code.
  // Buffers the data, and parses it into discrete messages of the form used in
  // MSNP (i.e. space-separated tokens, terminated with \r\n, and possibly a
  // "payload" blob of data following that.
  onDataAvailable: function(request, ctxt, inStr, sourceOffset, count) {
    this._data += this._binaryInputStream.readBytes(count);
    if(this._timeout) clearTimeout(this._timeout);

    if(this.binaryMode == false) {
      while(this._data) {
        var lineEnd = this._data.indexOf('\r\n');
        var toConsume = lineEnd + 2; // 2 == "\r\n".length
        if(lineEnd == -1) return; // need to buffer more
        var msgdata = this._data.substr(0, lineEnd);
        var msgbits = msgdata.split(" ");
        if(msgbits[0] in this._payloadCommands) {
          var payloadLength = parseInt(msgbits[msgbits.length - 1]);
          // bail out if message isn't entirely here yet
          if(this._data.length < payloadLength + toConsume) return;
          this._dispatchProtocolMessage(msgbits, toConsume, payloadLength);
        } else {
          this._dispatchProtocolMessage(msgbits, toConsume, 0);
        }
      }
    } else {
      while(this._data) {
        var secondByte = this._data.charCodeAt(1);
        var thirdByte = this._data.charCodeAt(2);
        var bodyLength = secondByte + (thirdByte * 256);
        if(this._data.length < bodyLength + 3) return;
        var bodyBytes = this._data.substr(3, bodyLength);
        this._dispatchBinaryData(bodyBytes, bodyLength);
      }
    }
  },

  _dispatchProtocolMessage: function(msgbits, numMsgBytes, payloadLength) {
    this._logMsg('<<< ', '.<. ', this._data.slice(0, numMsgBytes + payloadLength));
    const payload = this._data.substr(numMsgBytes, payloadLength);
    this._data = this._data.slice(numMsgBytes + payloadLength);
    this.onProtocolMessageReceived(msgbits, payload);
  },

  _dispatchBinaryData: function(bodyBytes, bodyLength) {
    this._data = this._data.slice(bodyLength + 3);
    this.onBinaryDataReceived(bodyBytes, bodyLength);
  },

  _logMsg: function(prefix, infix, txt) {
    infix = "\n" + infix;
    this._log(prefix + txt.replace(/\s+$/, '').replace(/\r?\n/g, infix));
  },

  _log: function(str) {
    dump(str + "\n");
  },

  // nsIRequestObserver methods (required by nsIStreamListener)
  onStartRequest: function(request, ctxt) {
    this._log("BaseConnection.onStartRequest");
  },

  onStopRequest: function(request, ctxt, status) {
    this._log("BaseConnection.onStopRequest (" + status + ")");
    if(status == 2152398868) {
      this.isConnected = false;
      this.onConnectionReset();
    }
  },

  // required by nsISocketListener
  onStopListening: function(socket, status) {
    this._log("BaseConnection.onStopListening");
    delete this.serverSock;
  }
}


// Wrapper to make "this" be the right object inside .onConnectionTimedOut()
function onTimeOutHelper(connection) {
  connection.onConnectionTimedOut();
}
