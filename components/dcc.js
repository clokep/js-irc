// Implement an ircIDCCSpecification to handle:
xdcc = function() { }
xdcc.prototype = {
  commands: {
    "DCC": function(aMessage) false
  }
}

// Standard DCC commands
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
