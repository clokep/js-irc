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
 *   Parser based on code from ChatZilla (JSIRC Library)
 *     New Dimensions Consulting, Inc & Robert Ginda <rginda@ndcico.com> 1999
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
 *   RFC2811 (IRC channel management) -- http://tools.ietf.org/html/rfc2811 <-- Mostly for servers
 *   RFC2812 (IRC client protocol) -- http://tools.ietf.org/html/rfc2812
 *   RFC2813 (IRC server protocol) -- http://tools.ietf.org/html/rfc2813 <-- Servers only
 *
 *   DCC specification -- http://www.irchelp.org/irchelp/rfc/dccspec.html
 *   CTCP specification -- http://www.irchelp.org/irchelp/rfc/ctcpspec.html
 *   Updated CTCP specification (not fully supported by clients) -- http://www.invlogic.com/irc/ctcp.html
 *
 *   ISupport (response code 005; supported by most servers) -- http://www.irc.org/tech_docs/draft-brocklesby-irc-isupport-03.txt
 */

// TODO Can we auto-detect character encoding?

var Cc = Components.classes;
var Ci = Components.interfaces;
var Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
//Cu.import("resource:///modules/jsProtoHelper.jsm");
Cu.import("resource://irc-js/jsProtoHelper.jsm"); // XXX Custom jsProtoHelper

function dump(str) {
  Cc["@mozilla.org/consoleservice;1"]
    .getService(Ci.nsIConsoleService)
    .logStringMessage(str);
}

function Chat(aAccount, aName) {
  this._init(aAccount);
  this._name = aName;
  this._participants = [new ConvChatBuddy(aName)]; // XXX Ensure nsEnumerator is not null
}
Chat.prototype = {
  _name: "Chat Conversation",
  _topic: null,
  _topicSetter: null,

  sendMsg: function(aMessage) {
    this.account._sendMessage("PRIVMSG", this.name, [aMessage]);
    this.writeMessage(this.account.name,
                      aMessage,
                      {outgoing: true});
  },
  
  get name() this._name,
  get topic() this._topic,
  get topicSetter() this._topicSetter,
  setTopic: function(aTopic, aTopicSetter) {
    this._topic = aTopic;
    this._topicSetter = aTopicSetter;
    // XXX Notify observers
  }
}
Chat.prototype.__proto__ = GenericChatConversationPrototype;

function ConvChatBuddy(aName) {
  this._name = aName;
}
ConvChatBuddy.prototype = {
  get name() this._name
}
ConvChatBuddy.prototype.__proto__ = GenericConvChatBuddyPrototype;

function Conversation(aAccount, aName) {
  this._init(aAccount);
  this._name = aName;
}
Conversation.prototype = {
  sendMsg: function(aMessage) {
    this.account._sendMessage(aMessage);
    this.writeMessage(this.account.name,
                      aMessage,
                      {outgoing: true});
  },
  get name() this._name
};
Conversation.prototype.__proto__ = GenericConversationPrototype;

function Account(aProtoInstance, aKey, aName) {
  this._init(aProtoInstance, aKey, aName);
}
Account.prototype = {
  _conv: null, // XXX Remove me eventually
  _conversations: {},
  _socketTransport: null,
  _inputStream: null,
  _outputStream: null,
  _scritableInputStream: null,
  _pump: null,
  _server: "irc.mozilla.org",
  //_server: "localhost",
  _port: 6667,
  _mode: 0x00, // bit 2 is 'w' (wallops) and bit 3 is 'i' (invisible)
  _realname: "clokep",
  _buddies: {},

  // Data listener object
  onStartRequest: function(request, context) { },
  onStopRequest: function(request, context, status) { },
  onDataAvailable: function(request, context, inputStream, offset, count) {
    let data = this._scriptableInputStream.read(count).split(/\r\n/);
    for (var i = 0; i < data.length; i++)
      if (data[i].length) // Skip empty messages
        this._handleMessage(data[i]);
  },
  
  connect: function() {    
    this.base.connecting();
    let self = this;
    this._conv = new Conversation(self, this._server); // XXX Remove me eventually
    this._conv.writeMessage(this._server, "You're now chatting on IRC!", {system: true});

    var socketTransportService = Cc["@mozilla.org/network/socket-transport-service;1"].getService(Ci.nsISocketTransportService);
    this._socketTransport = socketTransportService.createTransport(null, // Socket type
                                                                   0, // Length of socket types
                                                                   this._server, // Host
                                                                   this._port, // Port
                                                                   null); // Proxy info
    // Add a socketTransport listener so we can give better info to this.base.connecting()
    
    this._outputStream = this._socketTransport.openOutputStream(0, // flags
                                                                0, // Use default segment size
                                                                0); // Use default segment count
    this._inputStream = this._socketTransport.openInputStream(0, // flags
                                                              0, // Use default segment size
                                                              0); // Use default segment count

    this._scriptableInputStream = Cc["@mozilla.org/scriptableinputstream;1"]
                                    .createInstance(Ci.nsIScriptableInputStream);
    this._scriptableInputStream.init(this._inputStream);

    this._pump = Cc["@mozilla.org/network/input-stream-pump;1"]
                   .createInstance(Ci.nsIInputStreamPump);
    this._pump.init(this._inputStream, // Data to read
                    -1, // Current offset
                    -1, // Read all data
                    0, // Use default segment size
                    0, // Use default segment length
                    false); // Do not close when done
    this._pump.asyncRead(this, null);
    
    this._connnectionRegistration();
  },
  
  disconnect: function() {
    this._sendMessage("QUIT"); // RFC 2812 Section 3.1.7
    
    this._outputStream.close();
    this._inputStream.close();
    this.socketTransport.close(Components.results.NS_OK);
  },
  
  /*
   * aComponents implements purpleIChatRoomFieldValues
   */
  joinChat: function(aComponents) {
    dump(this.getChatRoomDefaultFieldValue("Test"));
    dump(JSON.stringify(aComponents));
    this._base.joinChat(aComponents);
  },
  
  // Attributes
  get canJoinChat() true,
  
  // Private functions
  /*
   * See section 2.3 of RFC 2812
   * 
   * parseMessage takes the message string and pulls useful information out. It
   * returns a message object which contains:
   *   source..........source of the message
   *   nickname........user's nickname
   *   user............user's username
   *   host............user's hostname
   *   command.........the command being implemented
   *   params..........list of parameters
   */
  // See http://joshualuckers.nl/2010/01/10/regular-expression-to-match-raw-irc-messages/
  _parseMessage: function(aData) {
    var aMessage = {};
    aMessage.rawMessage = aData;
    let temp;

    if ((temp = aData.match(/^(?:[:@]([^ ]+) )?([^ ]+)(?: ((?:[^: ][^ ]* ?)*))?(?: ?:(.*))?$/))) {
      // Assume from server if not specified
      aMessage.source = temp[1] || this._server;
      aMessage.command = temp[2];
      aMessage.params = temp[3] ? temp[3].trim().split(/ +/) : [];
      if (temp[4])
        aMessage.params.push(temp[4]);
      
      if ((temp = aMessage.source.match(/([^ !@]+)(?:!([^ @]+))?(?:@([^ ]+))?/))) {
        aMessage.nickname = temp[1];
        aMessage.user = temp[2] || null; // Optional
        aMessage.host = temp[3] || null; // Optional
      }
    }
    return aMessage;
  },
  
  /*
   * Implement Section 5 of RFC 2812
   */
  _handleMessage: function(aRawMessage) {
    var aMessage = this._parseMessage(aRawMessage);
    dump(JSON.stringify(aMessage));
    if (!aMessage.source) // No real message
      return;
   
    // Handle command responses
    switch (aMessage.command.toUpperCase()) {
      case "ERROR":
        // ERROR <error message>
        // Report the error
        this._conv.writeMessage(aMessage.source,
                                aMessage.rawMessage,
                                {system: true, error: true});
        break;
      case "INVITE":
        // INVITE  <nickname> <channel>
        // XXX prompt user to join channel
        break;
      case "JOIN":
        // JOIN ( <channel> *( "," <channel> ) [ <key> *( "," <key> ) ] ) / "0"
        if (aMessage.nickname == this.name) // Successfully joined a room
          this._getConversation(aMessage.params[0]); // Open the conversation
        // XXX display join messages from users
        break;
      case "KICK":
        // KICK <channel> *( "," <channel> ) <user> *( "," <user> ) [<comment>]
        var usersNames = params[1].split(",");
        for (var aChannelName in aMessage.params[0].split(",")) {
          var aConversation = this._getConversation(aChannelName);
          for (var aUsername in usersNames)
            aConversation.writeMessage(aMessage.source,
                                       aMessage.params[2] || (aUsername + " has been kicked."),
                                       {system: true});
        }
        break;
      case "MODE":
        // MODE <nickname *( ( "+" / "-") *( "i" / "w" / "o" / "O" / "r" ) )
        // XXX keep track of our mode? Display in UI?
        break;
      case "NOTICE":
        // NOTICE <msgtarget> <text>
        // XXX
        this._conv.writeMessage(aMessage.source,
                                aMessage.params.join(" "),
                                {system: true});
        break;
      case "PART":
        // PART <channel> *( "," <channel> ) [ <Part Message> ]
        // XXX display part messages from users
        for (var aChannelName in aMessage.params[0].split(",")) {
          var aConversation = this._getConversation(aChannelName);
          aConversation.writeMessage(aMessage.source,
                                     aMessage.params[1] || "has parted.",
                                     {system: true});
        }
        break;
      case "PING":
        // PING <server1 [ <server2> ]
        // Keep the connection alive
        this._sendMessage("PONG", [aMessage.params[0]]);
        break;
      case "PRIVMSG":
        // PRIVMSG <msgtarget> <text to be sent>
        var aConversation = this._getConversation(aMessage.params[0]);
        aConversation.writeMessage(aMessage.nickname || aMessage.source,
                                   aMessage.params[1],
                                   {incoming: true});
        break;
      case "QUIT":
        // QUIT [ < Quit Message> ]
        // XXX Needs to loop over every conversation with the user and display that they quit
        break;
      case "SQUIT":
        // XXX do we need this?
        break;
      case "TOPIC":
        // TOPIC <channel> [ <topic> ]
        // XXX update UI with topic
        break;
      case "001": // RPL_WELCOME
        // Welcome to the Internet Relay Network <nick>!<user>@<host>
        this.base.connected();
      case "002": // RPL_YOURHOST
        // Your host is <servername>, running version <ver>
        // XXX Use the host instead of the user for all the "server" messages?
      case "003": // RPL_CREATED
        //This server was created <date>
        // XXX parse this date and keep it for some reason? Do we care?
      case "004": // RPL_MYINFO
        // <servername> <version> <available user modes> <available channel modes>
        // XXX parse the available modes, let the UI respond and inform the user
      case "005": // RPL_BOUNCE
        // Try server <server name>, port <port number>
        // XXX irc.mozilla.org seems to respond with a list of available
        //     commands and limits the server supports
        this._conv.writeMessage(aMessage.source,
                                aMessage.params.slice(1).join(" "),
                                {system: true});
        break;
      case "200": // RPL_TRACELINK
        // Link <version & debug level> <destination> <next server> V<protocol version> <link updateime in seconds> <backstream sendq> <upstream sendq>
        // XXX
      case "201": // RPL_TRACECONNECTING
        // Try. <class> <server>
        // XXX
      case "202": // RPL_TRACEHANDSHAKE
        // H.S. <class> <server>
        // XXX
      case "203": // RPL_TRACEUNKNOWN
        // ???? <class> [<client IP address in dot form>]
        // XXX
      case "204": // RPL_TRACEOPERATOR
        // Oper <class> <nick>
        // XXX
      case "205": // RPL_TRACEUSER
        // User <class> <nick>
        // XXX
      case "206": // RPL_TRACESERVER
        // Serv <class> <int>S <int>C <server> <nick!user|*!*>@<host|server> V<protocol version>
        // XXX
      case "207": // RPL_TRACESERVICE
        // Service <class> <name> <type> <active type>
        // XXX
      case "208": // RPL_TRACENEWTYPE
        // <newtype> 0 <client name>
        // XXX
      case "209": // RPL_TRACECLASS
        // Class <class> <count>
        // XXX
        break;
      case "210": // RPL_TRACERECONNECTION
        // Unused.
        break;
      case "211": // RPL_STATSLINKINFO
        // <linkname> <sendq> <sent messages> <sent Kbytes> <received messages> <received Kbytes> <time open>
        // XXX
      case "212": // RPL_STATSCOMMAND
        // <command> <count> <byte count> <remote count>
        // XXX
        break;
      case "213": // RPL_STATSCLINE
      case "214": // RPL_STATSNLINE
      case "215": // RPL_STATSILINE
      case "216": // RPL_STATSKLINE
      case "217": // RPL_STATSQLINE
      case "218": // RPL_STATSYLINE
        // Non-generic
        break;
      case "219": // RPL_ENDOFSTATS
        // <stats letter> :End of STATS report
        // XXX
        break;
      case "221": // RPL_UMODEIS
        // <user mode string>
        // XXX update the UI accordingly
        break;
      case "231": // RPL_SERVICEINFO
      case "232": // RPL_ENDOFSERVICES
      case "233": // RPL_SERVICE
        // Non-generic
        break;
      case "234": // RPL_SERVLIST
        // <name> <server> <mask> <type> <hopcount> <info>
        // XXX
      case "235": // RPL_SERVLISTEND
        // <mask> <type> :End of service listing
        // XXX
        break;
      case "240": // RPL_STATSVLINE
      case "241": // RPL_STATSLLINE
        // Non-generic
        break;
      case "242": // RPL_STATSUPTIME
        // :Server Up %d days %d:%02d:%02d
        // XXX Do we care?
      case "243": // RPL_STATSOLINE
        // O <hostmask> * <name>
        // XXX display?
        break;
      case "244": // RPL_STATSHLINE
      case "245": // RPL_STATSSLINE
        // Non-generic
        break;
      case "246": // RPL_STATSPING
      case "247": // RPL_STATSBLINE
      case "250": // RPL_STATSDLINE
        // Non-generic
        break;
      case "251": // RPL_LUSERCLIENT
        // :There are <integer> users and <integer> services on <integer> servers
        // XXX parse this and display in the UI?
      case "252": // RPL_LUSEROP, 0 if not sent
        // <integer> :operator(s) online
        // XXX parse this and display in the UI?
      case "253": // RPL_LUSERUNKNOWN, 0 if not sent
        // <integer> :unknown connection(s)
        // XXX parse this and display in the UI?
      case "254": // RPL_LUSERCHANNELS, 0 if not sent
        // <integer> :channels formed
        // XXX parse this and display in the UI?
      case "255": // RPL_LUSERME
        // :I have <integer> clients and <integer> servers
        // XXX parse this and display in the UI?
      case "256": // RPL_ADMINME
        // <server> :Administrative info
      case "257": // RPL_ADMINLOC1
        // :<admin info>
        // City, state & country
      case "258": // RPL_ADMINLOC2
        // :<admin info>
        // Institution details
      case "259": // RPL_ADMINEMAIL
        // :<admin info>
        // XXX parse this for a contact email
        this._conv.writeMessage(aMessage.source,
                                aMessage.params.slice(1).join(" "), // skip nickname
                                {system: true});
        break;
      case "261": // RPL_TRACELOG
        // File <logfile> <debug level>
        // XXX
      case "262": // RPL_TRACEEND
        // <server name> <version & debug level> :End of TRACE"
        break;
      case "263": // RPL_TRYAGAIN
        // <command> :Please wait a while and try again.
        // XXX setTimeout for a minute or so and try again?
        break;
      case "265": // XXX nonstandard
        // :Current Local Users: <integer>  Max: <integer>
      case "266": // XXX nonstandard
        // :Current Global Users: <integer>  Max: <integer>
        this._conv.writeMessage(aMessage.source,
                                aMessage.params[1], // skip nickname
                                {system: true});
      case "300": // RPL_NONE
        // Non-generic
        break;
      case "301": // RPL_AWAY
        // <nick> :<away message>
        var aConversation = this._getConversation(aMessage.params[0])
        aConversation.writeMessage(aMessage.params[0],
                                   aMessage.params[1],
                                   {system: true});
        // XXX set user as away on buddy list / conversation lists
        break;
      case "302": // RPL_USERHOST
        // :*1<reply> *( " " <reply )"
        // reply = nickname [ "*" ] "=" ( "+" / "-" ) hostname
        // XXX What do we do?
      case "303": // RPL_ISON
        // :*1<nick> *( " " <nick> )"
        // XXX Need to update the buddy list once that's implemented
      case "305": // RPL_NOAWAY
        // :You are no longer marked as being away
        // XXX Update buddy list / conversation lists
      case "306": // RPL_NOWAWAY
        // :You have been marked as away
        // XXX Update buddy list / conversation lists
        break;
      case "311": // RPL_WHOISUSER
        // <nick> <user> <host> * :<real name>
        // XXX update user info
      case "312": // RPL_WHOISSERVER
        // <nick> <server> :<server info>
        // XXX update server info? Do nothing? Why would we ever receive this?
      case "313": // RPL_WHOISOPERATOR
        // <nick> :is an IRC operator
        // XXX update UI with operator status
      case "314": // RPL_WHOWASUSER
        // <nick> <user> <host> * :<real name>
        // XXX user isn't online anyway, so do we care?
      case "315": // RPL_ENDOFWHO
        // <name> :End of WHO list
        // XXX
        break;
      case "300": // RPL_WHOISCHANOP
        // Non-generic
        break;
      case "317": // RPL_WHOISIDLE
        // <nick> <integer> :seconds idle
        // XXX update UI with user's idle status
      case "318": // RPL_ENDOFWHOIS
        // <nick> :End of WHOIS list
      case "319": // RPL_WHOISCHANNELS
        // <nick> :*( ( "@" / "+" ) <channel> " " )
        // XXX update UI with voice or operator status
        break;
      case "321": // RPL_LISTSTART
        // Obsolete. Not used.
        break;
      case "322": // RPL_LIST
        // <channel> <# visible> :<topic>
        // XXX parse this for # users & topic
        break;
      case "323": // RPL_LISTEND
        // :End of LIST
        break;
      case "324": // RPL_CHANNELMODEIS
        // <channel> <mode> <mode params>
        // XXX parse this and have the UI respond accordingly
        break;
      case "325": // RPL_UNIQOPIS
        // <channel> <nickname>
        // XXX parse this and have the UI respond accordingly
        break;
      case "331": // RPL_NOTOPIC
        // <channel> :No topic is set
        // XXX Do nothing I think?
        break;
      case "332": // RPL_TOPIC
        // <channel> :topic
        var aConversation = this._getConversation(aMessage.params[1]);
        aConversation.setTopic(aMessage.params[2]); // XXX Not settable right now
        break;
      // case "333": // XXX nonstandard
      case "341": // RPL_INVITING
        // <channel> <nick>
        // XXX invite successfully sent? Display this?
        break;
      case "342": // RPL_SUMMONING
        // <user> :Summoning user to IRC
        // XXX is this server only?
        break;
      case "346": // RPL_INVITELIST
        // <chanel> <invitemask>
        // XXX what do we do?
      case "347": // RPL_ENDOFINVITELIST
        // <channel> :End of channel invite list
        // XXX what do we do?
        break;
      case "348": // RPL_EXCEPTLIST
        // <channel> <exceptionmask>
      case "349": // RPL_ENDOFEXCEPTIONLIST
        // <channel> :End of channel exception list
        // XXX update UI?
        break;
      case "351": // RPL_VERSION
        // <version>.<debuglevel> <server> :<comments>
        // XXX Do we care?
        break;
      case "352": // RPL_WHOREPLY
        // <channel> <user> <host> <server> <nick> ( "H" / "G" ) ["*"] [ ("@" / "+" ) ] :<hopcount> <real name>
        // XXX
        break;
      case "353": // RPL_NAMREPLY
        // ( "=" / "*" / "@" ) <channel> :[ "@" / "+" ] <nick> *( " " [ "@" / "+" ] <nick> )
        // XXX Keep if this is secret (@), private (*) or public (=)
        var aConversation = this._getConversation(aMessage.params[2]);
        aMessage.params[3].split(" ").forEach(function(aNickname) {
          aConversation._participants.push(new ConvChatBuddy(aNickname));
          if (!this._buddies[aNickname]) // XXX Needs to be put to lower case and ignore the @+ at the beginning
            this._buddies[aNickname] = {}; // XXX new Buddy()?
        });
        break;
      case "361": // RPL_KILLDONE
      case "362": // RPL_CLOSING
      case "363": // RPL_CLOSEEND
        // Non-generic
        break;
      case "364": // RPL_LINKS
        // <mask> <server> :<hopcount> <server info>
        // XXX
      case "365": // RPL_ENDOFLINKS
        // <mask> :End of LINKS list
        // XXX
        break;
      case "366": // RPL_ENDOFNAMES
        // <channel> :End of NAMES list
        // XXX use with 353 RPL_NAMREPLY
        break;
      case "367": // RPL_BANLIST
        // <channel> <banmask>
        // XXX
      case "368": // RPL_ENDOFBANLIST
        // <channel> :End of channel ban list
        // XXX
        break;
      case "369": // RPL_ENDOFWHOWAS
        // <nick> :End of WHOWAS
        break;
      case "371": // RPL_INFO
        // :<string>
        this._conv.writeMessage(aMessage.source,
                                aMessage.params[1],
                                {system: true});
        break;
      case "372": // RPL_MOTD
        // :- <text>
        if (aMessage.params[1].length > 2) // Ignore empty messages
          this._conv.writeMessage(aMessage.source,
                                  aMessage.params[1].slice(2),
                                  {incoming: true});
        break;
      case "373": // RPL_INFOSTART
        // Non-generic
        break;
      case "374": // RPL_ENDOFINFO
        // :End of INFO list
        break;
      case "375": // RPL_MOTDSTART
        // :- <server> Message of the day -
        this._conv.writeMessage(aMessage.source,
                                aMessage.params[1].slice(2,-2),
                                {incoming: true});
        break;
      case "376": // RPL_ENDOFMOTD
        // :End of MOTD command
        break;
      case "381": // RPL_YOUREOPER
        // :You are now an IRC operator
        this._conv.writeMessage(aMessage.source,
                                aMessage.params[0],
                                {system: true});
        // XXX update UI accordingly to show oper status
        break;
      case "382": // RPL_REHASHING
        // <config file> :Rehashing
        this._conv.writeMessage(aMessage.source,
                                aMessage.params.join(" "),
                                {system: true});
        break;
      case "383": // RPL_YOURESERVICE
        // You are service <servicename>
        // XXX Could this ever happen?
        break;
      case "384": // RPL_MYPORTIS
        // Non-generic
        break;
      case "391": // RPL_TIME
        // <server> :<string showing server's local time>
        // XXX parse date string & store or just show it?
        break;
      case "392": // RPL_USERSSTART
        // :UserID   Terminal  Host
        // XXX
      case "393": // RPL_USERS
        // :<username> <ttyline> <hostname>
        // XXX store into buddy list
      case "394": // RPL_ENDOFUSERS
        // :End of users
        // XXX
        break;
      case "395": // RPL_NOUSERS
        // :Nobody logged in
        // XXX clear buddy list

      // Error messages, Implement Section 5.2 of RFC 2812
      case "401": // ERR_NOSUCHNICK
        // <nickname> :No such nick/channel
        // XXX Error saying the nick doesn't exist?
      case "402": // ERR_NOSUCHSERVER
        // <server name> :No such server
        // XXX Error saying the server doesn't exist?
      case "403": // ERR_NOSUCHCHANNEL
        // <channel name> :No such channel
        // XXX Error saying channel doesn't exist?
      case "404": // ERR_CANNONTSENDTOCHAN
        // <channel name> :Cannot send to channel
        // XXX handle that the channel didn't receive the message
      case "405": // ERR_TOOMANYCHANNELS
        // <channel name> :You have joined too many channels
        // XXX Error saying too many channels?
      case "406": // ERR_WASNOSUCHNICK
        // <nickname> :There was no such nickname
        // XXX Error saying the nick never existed
      case "407": // ERR_TOOMANYTARGETS
        // <target> :<error code> recipients. <abord message>
      case "408": // ERR_NOSUCHSERVICE
        // <service name> :No such service
      case "409": // ERR_NOORIGIN
        // :No origin specified
        // XXX failed PING/PONG message, this should never occur
        break;
      case "411": // ERR_NORECIPIENT
        // :No recipient given (<command>)
        // XXX This should never happen.
        break;
      case "412": // ERR_NOTEXTTOSEND
        // :No text to send
        // XXX this shouldn't happen?
        break;
      case "413": // ERR_NOTOPLEVEL
        // <mask> :No toplevel domain specified
      case "414": // ERR_WILDTOPLEVEL
        // <mask> :Wildcard in toplevel domain
      case "415": // ERR_BADMASK
        // <mask> :Bad Server/host mask
        break;
      case "421": // ERR_UNKNOWNCOMMAND
        // <command> :Unknown command
        // XXX This shouldn't occur
        break;
      case "422": // ERR_NOMOTD
        // :MOTD File is missing
        break;
      case "423": // ERR_NOADMININFO
        // <server> :No administrative info available
        break;
      case "424": // ERR_FILEERROR
        // :File error doing <file op> on <file>
      case "431": // ERR_NONICKNAMEGIVEN
        // :No nickname given
      case "432": // ERR_ERRONEUSNICKNAME
        // <nick> :Erroneous nickname
        // XXX Prompt user for new nick? Autoclean characters?
      case "433": // ERR_NICKNAMEINUSE
        // <nick> :Nickname is already in use
        // XXX add 1 or increment last digit of nickname
        break;
      case "436": // ERR_NICKCOLLISION
        // <nick> :Nickname collision KILL from <user>@<host>
        // Take the returned nick and increment the last character
        this.name = aMessage.params[0].slice(0, -1) +
          String.fromCharCode(
            aMessage.params[0].charCodeAt(aMessage.params[0].length - 1) + 1
          );
        this._sendMessage("NICK", [this.name]); // Nick message
        // XXX inform user?
        break;
      case "437": // ERR_UNAVAILRESOURCE
        // <nick/channel> :Nick/channel is temporarily unavailable
      case "441": // ERR_USERNOTINCHANNEL
        // <nick> <channel> :They aren't on that channel
      case "442": // ERR_NOTONCHANNEL
        // <channel> :You're not on that channel
      case "443": // ERR_USERONCHANNEL
        // <user> <channel> :is already on channel
      case "444": // ERR_NOLOGIN
        // <user> :User not logged in
      case "445": // ERR_SUMMONDISABLED
        // :SUMMON has been disabled
        // XXX keep track of this and disable UI associated?
      case "446": // ERR_USERSDISABLED
        // :USERS has been disabled
        // XXX Disabled all buddy list etc.
      case "451": // ERR_NOTREGISTERED
        // :You have not registered
        // XXX We shouldn't get this?
      case "461": // ERR_NEEDMOREPARAMS
        // <command> :Not enough parameters
      case "462": // ERR_ALREADYREGISTERED
        // :Unauthorized command (already registered)
      case "463": // ERR_NOPERMFORHOST
        // :Your host isn't among the privileged
      case "464": // ERR_PASSWDMISMATCH
        // :Password incorrect
        // XXX prompt user for new password
      case "465": // ERR_YOUREBANEDCREEP
        // :You are banned from this server
        // XXX Disconnect account?
        this._conv.writeMessage(aMessage.source,
                              aMessage.rawMessage,
                              {error: true});
        break;
      case "466": // ERR_YOUWILLBEBANNED
        this.disconnect(); // XXX no reason to be connected if we can't do anything
        break;
      case "467": // ERR_KEYSET
        // <channel> :Channel key already set
      case "471": // ERR_CHANNELISFULL
        // <channel> :Cannot join channel (+l)
      case "472": // ERR_UNKNOWNMODE
        // <char> :is unknown mode char to me for <channel>
      case "473": // ERR_INVITEONLYCHAN
        // <channel> :Cannot join channel (+i)
      case "474": // ERR_BANNEDFROMCHAN
        // <channel> :Cannot join channel (+b)
      case "475": // ERR_BADCHANNELKEY
        // <channel> :Cannot join channel (+k)
        // XXX need to inform user
      case "476": // ERR_BADCHANMASK
        // <channel> :Bad Channel Mask
      case "477": // ERR_NOCHANMODES
        // <channel> :Channel doesn't support modes
      case "478": // ERR_BANLISTFULL
        // <channel> <char> :Channel list is full
      case "481": // ERR_NOPRIVILEGES
        // :Permission Denied- You're not an IRC operator
        // XXX ask to auth?
      case "482": // ERR_CHANOPRIVSNEEDED
        // <channel> :You're not channel operator
        // XXX ask for auth?
      case "483": // ERR_CANTKILLSERVER
        // :You can't kill a server!
        // XXX?
      case "484": // ERR_RESTRICTED
        // :Your connection is restricted!
        // Indicates user mode +r
      case "485": // ERR_UNIQOPPRIVSNEEDED
        // :You're not the original channel operator
        // XXX ask to auth?
      case "491": // ERR_NOOPERHOST
        // :No O-lines for your host
        // XXX
      case "492": //ERR_NOSERVICEHOST
        // Non-generic
      case "501": // ERR_UMODEUNKNOWNFLAGS
        // :Unknown MODE flag
        // XXX could this happen?
      case "502": // ERR_USERSDONTMATCH
        // :Cannot change mode for other users
        this._conv.writeMessage(aMessage.source,
                                aMessage.rawMessage,
                                {error: true});
        break;
      default:
        // Output it for debug
        dump("Unhandled: " + aMessage.rawMessage);
        this._conv.writeMessage(aMessage.source,
                                aMessage.rawMessage,
                                {incoming: true});
        break; // Do nothing
    }
  },
  
  /*
   * Returns a conversation (creates it if it doesn't exist)
   */
  _getConversation: function(aConversationName) {
    // Handle Scandanavian lower case
    // XXX Move this to a function
    let aNormalizedConversationName = aConversationName.toLowerCase()
                                                       .replace('[','{')
                                                       .replace(']','}')
                                                       .replace('\\','|')
                                                       .replace('~','^');
    if (!this._conversations[aNormalizedConversationName])
      if ("&#+!".indexOf(aNormalizedConversationName.charAt(0)) != -1)
        this._conversations[aNormalizedConversationName] = new Chat(this, aConversationName);
      else
        this._conversations[aNormalizedConversationName] = new Conversation(this, aConversationName);
    return this._conversations[aNormalizedConversationName];
  },
  
  _sendMessage: function(aCommand, aParams, aTarget) {
    let aMessage = aCommand;
    if (aTarget)
      aMessage += " " + aTarget;
    if (aParams && aParams.length)
      if (aParams.length > 1)
        aMessage += " "  + aParams.slice(0,-1).join(" ") + " :" + aParams.slice(-1);
      else
        aMessage += " :" + aParams[0];
    // XXX should check length of aMessage?
    aMessage += "\r\n";
    //aMessage = aCommand + " " + aTarget + " :" + aParams.join(" ") + "\r\n";
    dump("Sending... " + aMessage);
    this._outputStream.write(aMessage, aMessage.length);
  },
  
  // Implement section 3.1 of RFC 2812
  _connnectionRegistration: function() {
    if (this.password) // Password message, if provided
      this._sendMessage("PASS", [], this.password);
    this._sendMessage("NICK", [], this.name); // Nick message
    this._sendMessage("USER", [this.name, this._mode, "*", this._realname]); // User message
  }
};
Account.prototype.__proto__ = GenericAccountPrototype;

function IRCProtocol() { }
IRCProtocol.prototype = {
  get name() "IRC-JS",
  getAccount: function(aKey, aName) new Account(this, aKey, aName),
  classID: Components.ID("{607b2c0b-9504-483f-ad62-41de09238aec}")
};
IRCProtocol.prototype.__proto__ = GenericProtocolPrototype;

const NSGetFactory = XPCOMUtils.generateNSGetFactory([IRCProtocol]);

