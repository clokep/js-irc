// Implement an ircIDCCSpecification to handle:
xdcc = function() { }
xdcc.prototype = {
  commands: {
    "XDCC": function(aMessage) false
  }
}

// XDCC commands
var _xdcc = {
  "LIST": function(aMessage) false,
  "SEND": function(aMessage) false
}
