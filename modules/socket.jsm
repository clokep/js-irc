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
 * The Original Code is JSIRC Library
 *
 * The Initial Developer of the Original Code is New Dimensions Consulting, Inc.
 * Portions created by the Initial Developer are Copyright (C) 1999
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Robert Ginda, <rginda@ndcico.com>, original author
 *   Peter Van der Beken, <peter.vanderbeken@pandora.be>, necko-only version
 *   Stephen Clavering <mozilla@clav.me.uk>, extensively rewritten for
 *     MSNMessenger (http://msnmsgr.mozdev.org/)
 *   Benoît Renard <benoit@gawab.com>, MSNMessenger
 *   Patrick Cloke, <clokep@gmail.com>, updated, extended and generalized for
 *     Instantbird (http://www.instantbird.com)
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
 * Combines a lot of the Mozilla networking interfaces into a sane interface for
 * simple(r) use of sockets code.
 *
 * This implements nsIServerSocketListener, nsIStreamListener,
 * nsIRequestObserver, nsITransportEventSink, nsIBadCertListener2, and
 * nsISSLErrorListener.
 *
 * This uses nsISocketTransportServices, nsIServerSocket, nsIThreadManager,
 * nsIBinaryInputStream, nsIScriptableInputStream, nsIInputStreamPump,
 * nsIProxyService, nsIProxyInfo.
 *
 * High-level methods:
 *   .connect(<host>, <port>[, ("starttls" | "ssl" | "udp") [, <proxy>]])
 *   .disconnect()
 *   .reconnect()
 *   .listen(port)
 *   .send(String data)
 * High-level properties:
 *   .isConnected
 *
 * Users should "subclass" this object, i.e. set their .__proto__ to be it. And
 * then implement:
 *   onConnectionHeard()
 *   onConnectionTimedOut()
 *   onConnectionReset()
 *   onDataReceived(data)
 *   onBinaryDataReceived(ArrayBuffer data, int length)
 *   onTransportStatus(nsISocketTransport transport, nsresult status,
 *                     unsigned long progress, unsigned longprogressMax)
 *   log(message)
 */

/*
 * To Do:
 *   Add a message queue to keep from flooding a server (just an array, just
 *     keep shifting the first element off and calling as setTimeout for the
 *     desired flood time?).
 *   Check that binary data can be sent/received.
 */

var EXPORTED_SYMBOLS = ["Socket"];

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource:///modules/imServices.jsm");

// Network errors see: netwerk/base/public/nsNetError.h
const NS_ERROR_MODULE_NETWORK = 2152398848;
const NS_ERROR_CONNECTION_REFUSED = NS_ERROR_MODULE_NETWORK + 13;
const NS_ERROR_NET_TIMEOUT = NS_ERROR_MODULE_NETWORK + 14;
const NS_ERROR_NET_RESET = NS_ERROR_MODULE_NETWORK + 20;
const NS_ERROR_UNKNOWN_HOST = NS_ERROR_MODULE_NETWORK + 30;
const NS_ERROR_UNKNOWN_PROXY_HOST = NS_ERROR_MODULE_NETWORK + 42;
const NS_ERROR_PROXY_CONNECTION_REFUSED = NS_ERROR_MODULE_NETWORK + 72;

const Socket = {
  // Use this to use binary mode for the
  binaryMode: false,

  // XXX should this just check isAlive() for each stream?
  isConnected: false,

  // Set this for non-binary mode to automatically parse the stream into chunks
  // separated by delimiter.
  delimiter: null,
  // Set this for the segment size of incoming binary streams.
  segmentSize: 0,

  // Use this to add a URI scheme to the hostname when resolving the proxy, this
  // may be unnecessary for some protocols.
  uriScheme: "",

  // Flags used by nsIProxyService when resolving a proxy
  proxyFlags: Ci.nsIProtocolProxyService.RESOLVE_PREFER_SOCKS_PROXY,

  /*
   *****************************************************************************
   ******************************* Public methods ******************************
   *****************************************************************************
   */
  // Synchronously open a connection.
  connect: function(aHost, aPort, aSecurity, aProxy) {
    this.log("Connecting to: " + aHost + ":" + aPort);
    this.host = aHost;
    this.port = aPort;

    // Array of security options
    if (aSecurity)
      this.security = aSecurity;
    else
      this.security = [];

    // Choose a proxy, use the given one, otherwise get one from the proxy
    // service
    if (aProxy)
      this.proxy = aProxy;
    else {
      try {
        // Attempt to get a default proxy from the proxy service.
        let proxyService = Cc["@mozilla.org/network/protocol-proxy-service;1"]
                              .getService(Ci.nsIProtocolProxyService);
        let ioService = Cc["@mozilla.org/network/io-service;1"]
                           .getService(Ci.nsIIOService);

        // Add a URI scheme since, by default, some protocols (i.e. IRC) don't
        // have a URI scheme before the host.
        let uri = ioService.newURI(this.uriScheme + this.host, null, null);
        this.proxy = proxyService.resolve(uri, this.proxyFlags);
      } catch(e) {
        // We had some error getting the proxy service, just don't use one
        this.proxy = null;
      }
    }

    // Empty incoming and outgoing data storage buffers
    this._resetBuffers();

    // Create a socket transport
    let socketTS = Cc["@mozilla.org/network/socket-transport-service;1"]
                      .getService(Ci.nsISocketTransportService);
    this.transport = socketTS.createTransport(this.security,
                                              this.security.length, this.host,
                                              this.port, this.proxy);

    // Security notification callbacks (must support nsIBadCertListener2 and
    // nsISSLErrorListener for SSL connections, and possibly other interfaces).
    this.transport.securityCallbacks = this;

    // XXX this.transport.setTimeout(); for TIMEOUT_CONNECT and TIMEOUT_READ_WRITE
    // Open the incoming and outgoing sockets
    this._openStreams();

    // XXX should this call an onConnected function?
    this.isConnected = true;
  },

  // Reconnect to the current settings stored in the socket.
  reconnect: function() {
    // If there's nothing to reconnect to or we're connected, do nothing
    if (!this.isConnected && this.host && this.port)
      connect(this.host, this.port, this.security || [], this.proxy || null);
  },

  // Disconnect all open streams.
  disconnect: function() {
    this.log("Disconnect");

    // Close all input and output streams.
    if (this._inputStream)
      this._inputStream.close();
    if (this._outputStream)
      this._outputStream.close();
    // this._socketTransport.close(Components.results.NS_OK);

    // XXX should this be an onDisconnect function?
    this.isConnected = false;
  },

  // Listen for a connection on a port.
  // XXX take a timeout and then call stopListening?
  listen: function(port) {
    this.log("Listening on port " + port);

    this.serverSocket = Cc["@mozilla.org/network/server-socket;1"]
                           .createInstance(Ci.nsIServerSocket);
    this.serverSocket.init(port, false, -1);
    this.serverSocket.asyncListen(this);
  },

  // Stop listening for a connection.
  stopListening: function() {
    this.log("Stop listening");
    // Close the socket to stop listening.
    if (this.serverSocket)
      this.serverSocket.close();
  },

  // Send data on the output stream.
  sendData: function(/* string */ aData) {
    this.log("Send data: <" + aData + ">");
    try {
      this._outputStream.write(aData + this.delimiter,
                               aData.length + this.delimiter.length);
    } catch(e) {
      this.isConnected = false;
    }
  },

  sendBinaryData: function(/* ArrayBuffer */ aData) {
    this.log("Sending binary data data: <" + aData + ">");
    try {
      let uint8 = Uint8Array(aData);

      // Since there doesn't seem to be a uint8.get() method for the byte array
      let byteArray = [];
      for (let i = 0; i < uint8.byteLength; i++)
        byteArray.push(uint8[i]);

      // Send the data as a byte array
      this._binaryOutputStream.writeByteArray(byteArray, byteArray.length);
    } catch(e) {
      this.isConnected = false;
    }
  },

  /*
   *****************************************************************************
   ***************************** Interface methods *****************************
   *****************************************************************************
   */
  /*
   * nsIServerSocketListener methods
   */
  // Called after a client connection is accepted when we're listening for one.
  onSocketAccepted: function(aSocket, aTransport) {
    this.log("onSocketAccepted");
    // Store the values
    this.transport = aTransport;
    this.host = this.transport.host;
    this.port = this.transport.port;

    this._resetBuffers();
    this._openStreams();

    this.isConnected = true;

    this.onConnectionHeard();
    this.stopListening();
  },
  // Called when the listening socket stops for some reason.
  // The server socket is effectively dead after this notification.
  onStopListening: function(aSocket, aStatus) {
    this.log("onStopListening");
    delete this.serverSocket;
  },

  /*
   * nsIStreamListener methods
   */
  // onDataAvailable, called by Mozilla's networking code.
  // Buffers the data, and parses it into discrete messages.
  onDataAvailable: function(aRequest, aContext, aInputStream, aOffset, aCount) {
    if (this.binaryMode) {
      // Load the data from the stream
      let data = this._incomingDataBuffer.concat(this._binaryInputStream
                                                     .readByteArray(aCount));
      // XXX this needs to handle the _incomingDataBuffer in a reasonable way
      let buffer = new ArrayBuffer(data.length);
      let uintArray = new Uint8Array(buffer);
      uintArray.set(data);

      this.onBinaryDataReceived(buffer);
    } else {
      // Load the data from the stream
      this._incomingDataBuffer += this._scriptableInputStream.read(aCount);

      if (this.delimiter) {
        let data = this._incomingDataBuffer.split(this.delimiter);

        // Store the (possibly) incomplete part
        this._incomingDataBuffer = data.pop();

        // Send each string to the handle data function
        data.forEach(this.onDataReceived)
      } else {
        // Send the whole string to the handle data function
        this.onDataReceived(this._incomingDataBuffer);
        // Clear the buffer since we're not using it
        this._incomingDataBuffer = "";
      }
    }
  },

  /*
   * nsIRequestObserver methods
   */
  // Signifies the beginning of an async request
  onStartRequest: function(aRequest, aContext) {
    this.log("onStartRequest");
  },
  // Called to signify the end of an asynchronous request.
  onStopRequest: function(aRequest, aContext, aStatus) {
    this.log("onStopRequest (" + aStatus + ")");
    if (aStatus == NS_ERROR_NET_RESET) {
      this.isConnected = false;
      this.onConnectionReset();
    }
  },

  /*
   * nsIBadCertListener2
   */
  // Called when there's an error, return true to suppress the modal alert.
  notifyCertProblem: function(aSocketInfo, aStatus, aTargetSite) true,

  /*
   * nsISSLErrorListener
   */
  notifySSLError: function(aSocketInfo, aError, aTargetSite) true,


  /*
   *****************************************************************************
   ****************************** Private methods ******************************
   *****************************************************************************
   */
  _resetBuffers: function() {
    if (this.binaryMode)
      this._incomingDataBuffer = [];
    else
      this._incomingDataBuffer = "";
    this._outgoingDataBuffer = [];
  },
  _openStreams: function() {
    let threadManager = Cc["@mozilla.org/thread-manager;1"]
                           .getService(Ci.nsIThreadManager);
    this.transport.setEventSink(this, threadManager.currentThread);

    // No limit on the output stream buffer
    this._outputStream = this.transport.openOutputStream(0, // flags
                                                         this.segmentSize, // Use default segment size
                                                         -1); // Segment count
    if (!this._outputStream)
      throw "Error getting output stream.";

    this._inputStream = this.transport.openInputStream(0, // flags
                                                       0, // Use default segment size
                                                       0); // Use default segment count
    if (!this._inputStream)
      throw "Error getting input stream.";

    // Handle binary mode
    if (this.binaryMode) {
      this._binaryInputStream = Cc["@mozilla.org/binaryinputstream;1"]
                                   .createInstance(Ci.nsIBinaryInputStream);
      this._binaryInputStream.setInputStream(this._inputStream);

      this._binaryOutputStream = Cc["@mozilla.org/binaryoutputstream;1"]
                                    .createInstance(Ci.nsIBinaryOutputStream);
      this._binaryOutputStream.setOutputStream(this._outputStream);
    } else {
      this._scriptableInputStream =
        Cc["@mozilla.org/scriptableinputstream;1"]
           .createInstance(Ci.nsIScriptableInputStream);
      this._scriptableInputStream.init(this._inputStream);
    }

    this.pump = Cc["@mozilla.org/network/input-stream-pump;1"]
                   .createInstance(Ci.nsIInputStreamPump);
    this.pump.init(this._inputStream, // Data to read
                    -1, // Current offset
                    -1, // Read all data
                    0, // Use default segment size
                    0, // Use default segment length
                    false); // Do not close when done
    this.pump.asyncRead(this, this);
  },

  /*
   *****************************************************************************
   ********************* Methods for subtypes to override **********************
   *****************************************************************************
   */
  log: function(aString) {
    // XXX this should be empty until the user overrides it
    Services.console.logStringMessage(this.name + " " + aString);
  },
  // Called when a socket is accepted after listening.
  onConnectionHeard: function() { },
  // Called when a connection times out.
  onConnectionTimedOut: function() { },
  // Called when a socket request's network is reset
  onConnectionReset: function() { },

  // Called when ASCII data is available.
  onDataReceived: function(/*string */ aData) { },

  // Called when binary data is available.
  onBinaryDataReceived: function(/* ArrayBuffer */ aData) { },

  /*
   * nsITransportEventSink methods
   */
  onTransportStatus: function(aTransport, aStatus, aProgress, aProgressmax) { }
}

/*
// Test some stuff out
function TestSocket() {
  this.delimiter = "\r\n";
  this.onDataReceived = (function(aData) {
    this.log(aData);
    this.send("<" + aData + ">");
  }).bind(this);
  this.onConnectionHeard = function() { this.send("Outgoing"); };
}
TestSocket.prototype.__proto__ = Socket;

function setTimeout(aFunction, aDelay) {
  var timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
  var args = Array.prototype.slice.call(arguments, 2);
  timer.initWithCallback(function (aTimer) { aFunction.call(null, args); },
                         aDelay, Ci.nsITimer.TYPE_ONE_SHOT);
  return timer;
}

let s1 = new TestSocket();
s1.name = "s1";
s1.listen(10000);*/
/*
var tOut1, tOut2, tOut3;
tOut1 = setTimeout(function () {
  let s2 = new TestSocket();
  s2.name = "s2";
  s2.connect("localhost", 10000);

  tOut2 = setTimeout(function() {
    s1.log(s1.isConnected);
    s1.send("Outgoing delayed");
    s2.send("Incoming delayed");
  }, 5000);
}, 1000);
*/
