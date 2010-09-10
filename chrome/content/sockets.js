alert("Top");
//var Cc = Components.classes;
//var Ci = Components.interfaces;

function dump(str) {
	Cc["@mozilla.org/consoleservice;1"]
		.getService(Ci.nsIConsoleService)
		.logStringMessage(str);
}
alert("Open");
dump("Start");

var socketTransportService = Cc["@mozilla.org/network/socket-transport-service;1"].getService(Ci.nsISocketTransportService);
var socketTransport = socketTransportService.createTransport(null, // Socket type
															 0, // Length of socket types
															 "irc.mozilla.org", // Host
															 6667, // Port
															 null); // Proxy info

var outputStream = socketTransport.openOutputStream(0, // flags
													0, // Use default segment size
													0); // Use default segment count
var inputStream = socketTransport.openInputStream(0,
												  0, // Use default segment size
												  0); // Use default segment count

var scriptInputStream = Cc["@mozilla.org/scriptableinputstream;1"]
						  .createInstance(Ci.nsIScriptableInputStream);
scriptInputStream.init(inputStream);

var dataListener = {
	onStartRequest: function(request, context) {
		dump("start");
	},
	onStopRequest: function(request, context, status) {
		dump("stop");
		outputStream.close();
		scriptInputStream.close();
	},
	onDataAvailable: function(request, context, inputStream, offset, count) {
		dump("data");
		dump(scriptInputStream.read(count));
	}
};

var pump = Cc["@mozilla.org/network/input-stream-pump;1"]
			 .createInstance(Ci.nsIInputStreamPump);
pump.init(inputStream, // Data to read
		  -1, // Current offset
		  -1, // Read all data
		  0, // Use default segment size
		  0, // Use default segment length
		  false); // Do not close when done

pump.asyncRead(dataListener, null);
//var output = "GET / HTTP/1.0\n\n";
//outputStream.write(output, output.length);
