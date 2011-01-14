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

var EXPORTED_SYMBOLS = ["ircParser"];

serverMessage = function(message) {
  this._getConversation(message.source).writeMessage(
    message.source,
    message.params.slice(1).join(" "),
    {system: true}
  );
};
serverMessageEnd = function(message) {
  this._getConversation(message.source).writeMessage(
    message.source,
    message.params.slice(1, -1).join(" "),
    {system: true}
  );
};

ircParser = {
  // Handle command responses
	// XXX Should this have an argument for different RFCs?
	parse: function(thisArg, message) {
		let command = message.command.toUpperCase();
		if (this.rfc2812.hasOwnProperty(command))
			this.rfc2812[command].call(thisArg, message);
    else {
      // XXX Output it for debug
      Cu.reportError("Unhandled: " + message.rawMessage);
      this._getConversation(message.source).writeMessage(
        message.source,
        message.rawMessage,
        {error: true}
      );
    }
	},

  rfc2812: {
    "ERROR": function(message) {
      // ERROR <error message>
      // Client connection has been terminated
      for each (let conversation in this._conversations) {
        conversation.writeMessage(message.source,
                    "Your account has been disconnected.",
                    {system: true});
      }
      // Notify account manager
      this._disconnect();
    },
    "INVITE": function(message) {
      // INVITE  <nickname> <channel>
      // XXX prompt user to join channel
    },
    "JOIN": function(message) {
      // JOIN ( <channel> *( "," <channel> ) [ <key> *( "," <key> ) ] ) / "0"
      // Add the buddy to each channel
      for each (let channelName in message.params[0].split(",")) {
        let conversation = this._getConversation(channelName);
        if (message.nickname != this._nickname) {
        // Don't do anything if you join, RPL_NAMES takes care of that case
        conversation._getParticipant(message.nickname, true);
        let joinMessage = message.nickname + " [<i>" + message.source +
                  "</i>] entered the room.";
        conversation.writeMessage(message.nickname,
                      joinMessage,
                      {system: true});
        }
      }
    },
    "KICK": function(message) {
      // KICK <channel> *( "," <channel> ) <user> *( "," <user> ) [<comment>]
      var usersNames = message.params[1].split(",");
      for each (let channelName in message.params[0].split(",")) {
        let conversation = this._getConversation(channelName);
        for each (let username in usersNames) {
        let kickMessage = username + " has been kicked";
        if (message.params.length == 3)
          kickMessage += " [<i>" + message.params[2] + "</i>]";
        kickMessage += ".";
        conversation.writeMessage(message.nickname,
                      kickMessage,
                      {system: true});
        conversation._removeParticipant(username);
        }
      }
    },
    "MODE": function(message) {
      // MODE <nickname> *( ( "+" / "-") *( "i" / "w" / "o" / "O" / "r" ) )
      if (message.params.length == 3) {
        // Update the mode of a ConvChatBuddy & display in UI
        let conversation = this._getConversation(message.params[0]);
        let convChatBuddy = conversation._getParticipant(message.params[2]);
        convChatBuddy._setMode(message.params[1]);
        let modeMessage = "mode (" + message.params[1] + " " +
                  message.params[2] + ") by " + message.nickname;
        conversation.writeMessage(message.nickname,
                    modeMessage,
                    {system: true});
        conversation.notifyObservers(convChatBuddy, "chat-buddy-update");
      } else {
        // XXX keep track of our mode? Display in UI?
      }
    },
    "NICK": function(message) {
      // NICK <nickname>
      for each (let conversation in this._conversations) {
        if (conversation.isChat) {
        // Update the nick in every chat conversation
        let oldNick = message.nickname;
        let convChatBuddy = conversation._getParticipant(message.nickname);
        convChatBuddy._name = message.params[0];

        let nickMessage = message.nickname + " is now known as " +
                  message.params[0];
        conversation.writeMessage(message.nickname,
                      nickMessage,
                      {system: true});
        conversation.notifyObservers(convChatBuddy,
                       "chat-buddy-update",
                       message.nickname); // Old nickname
        }
      }
    },
    "NOTICE": function(message) {
      // NOTICE <msgtarget> <text>
      this._getConversation(message.source).writeMessage(
        message.nickname || message.source,
        message.params[1],
        {incoming: true}
      );
    },
    "PART": function(message) {
      // PART <channel> *( "," <channel> ) [ <Part Message> ]
      // Display the message and remove them from the rooms they're in
      for each (let channelName in message.params[0].split(",")) {
        if (!this._hasConversation(channelName))
        continue; // Handle when we closed the window
        let conversation = this._getConversation(channelName);
        let partMessage;
        if (message.nickname == this._nickname) // XXX remove all buddies?
        partMessage = "You have left the room (Part";
        else
        partMessage = message.nickname + " has left the room (Part";
        // If a part message was included, show it
        if (message.params.length == 2)
        partMessage += ": function(message) { " + message.params[1];
        partMessage += ").";
        conversation.writeMessage(message.source,
                    partMessage,
                    {system: true});
        conversation._removeParticipant(message.nickname);
      }
    },
    "PING": function(message) {
      // PING <server1 [ <server2> ]
      // Keep the connection alive
      this._sendMessage("PONG", [message.params[0]]);
    },
    "PRIVMSG": function(message) {
      // PRIVMSG <msgtarget> <text to be sent>
      // Display message in conversation
      this._getConversation(message.params[0]).writeMessage(
        message.nickname || message.source,
        message.params[1],
        {incoming: true}
      );
    },
    "QUIT": function(message) {
      // QUIT [ < Quit Message> ]
      // Loop over every conversation with the user and display that they quit
      for each (let conversation in this._conversations) {
        if (conversation.isChat &&
            conversation._hasParticipant(message.nickname)) {
          let quitMessage = message.nickname + " has left the room (Quit";
          // If a quit message was included, show it
          if (message.params.length)
            quitMessage += ": function(message) { " + message.params[0];
          quitMessage += ").";
          conversation.writeMessage(message.source,
                                    quitMessage,
                                    {system: true});
          conversation._removeParticipant(message.nickname);
        }
      }
    },
    "SQUIT": function(message) {
      // XXX do we need this?
    },
    "TOPIC": function(message) {
      // TOPIC <channel> [ <topic> ]
      // Show topic as a message
      this._getConversation(message.params[0]).writeMessage(
        message.nickname || message.source,
        message.nickname + " has changed the topic to: " + message.params[1],
        {system: true}
      );
    },
    "001": function(message) { // RPL_WELCOME
      // Welcome to the Internet Relay Network <nick>!<user>@<host>
      serverMessage.call(this, message);
      this.base.connected();
    },
    "002": function(message) { // RPL_YOURHOST
      // Your host is <servername>, running version <ver>
      // XXX Use the host instead of the user for all the "server" messages?
      serverMessage.call(this, message);
    },
    "003": function(message) { // RPL_CREATED
      //This server was created <date>
      // XXX parse this date and keep it for some reason? Do we care?
      serverMessage.call(this, message);
    },
    "004": function(message) { // RPL_MYINFO
      // <servername> <version> <available user modes> <available channel modes>
      // XXX parse the available modes, let the UI respond and inform the user
      serverMessage.call(this, message);
    },
    "005": function(message) { // RPL_BOUNCE
      // Try server <server name>, port <port number>
      // XXX See ISupport documentation
      serverMessage.call(this, message);
    },

    /*
     * Handle response to TRACE message
     */
    "200": function(message) { // RPL_TRACELINK
      // Link <version & debug level> <destination> <next server> V<protocol version> <link updateime in seconds> <backstream sendq> <upstream sendq>
      serverMessage.call(this, message);
    },
    "201": function(message) { // RPL_TRACECONNECTING
      // Try. <class> <server>
      serverMessage.call(this, message);
    },
    "202": function(message) { // RPL_TRACEHANDSHAKE
      // H.S. <class> <server>
      serverMessage.call(this, message);
    },
    "203": function(message) { // RPL_TRACEUNKNOWN
      // ???? <class> [<client IP address in dot form>]
      serverMessage.call(this, message);
    },
    "204": function(message) { // RPL_TRACEOPERATOR
      // Oper <class> <nick>
      serverMessage.call(this, message);
    },
    "205": function(message) { // RPL_TRACEUSER
      // User <class> <nick>
      serverMessage.call(this, message);
    },
    "206": function(message) { // RPL_TRACESERVER
      // Serv <class> <int>S <int>C <server> <nick!user|*!*>@<host|server> V<protocol version>
      serverMessage.call(this, message);
    },
    "207": function(message) { // RPL_TRACESERVICE
      // Service <class> <name> <type> <active type>
      serverMessage.call(this, message);
    },
    "208": function(message) { // RPL_TRACENEWTYPE
      // <newtype> 0 <client name>
      serverMessage.call(this, message);
    },
    "209": function(message) { // RPL_TRACECLASS
      // Class <class> <count>
      serverMessage.call(this, message);
    },
    "210": function(message) { // RPL_TRACERECONNECTION
      // Unused.
      serverMessage.call(this, message);
    },

    /*
     * Handle stats message
     **/
    "211": function(message) { // RPL_STATSLINKINFO
      // <linkname> <sendq> <sent messages> <sent Kbytes> <received messages> <received Kbytes> <time open>
      serverMessage.call(this, message);
    },
    "212": function(message) { // RPL_STATSCOMMAND
      // <command> <count> <byte count> <remote count>
      serverMessage.call(this, message);
    },
    "213": function(message) { // RPL_STATSCLINE
      serverMessage.call(this, message);
    },
    "214": function(message) { // RPL_STATSNLINE
      serverMessage.call(this, message);
    },
    "215": function(message) { // RPL_STATSILINE
      serverMessage.call(this, message);
    },
    "216": function(message) { // RPL_STATSKLINE
      serverMessage.call(this, message);
    },
    "217": function(message) { // RPL_STATSQLINE
      serverMessage.call(this, message);
    },
    "218": function(message) { // RPL_STATSYLINE
      // Non-generic
      serverMessage.call(this, message);
    },
    "219": function(message) { // RPL_ENDOFSTATS
      // <stats letter> :End of STATS report
      serverMessage.call(this, message);
    },

    /*
     *
     */
    "221": function(message) { // RPL_UMODEIS
      // <user mode string>
      // XXX update the UI accordingly
    },

    /*
     * Services
     */
    "231": function(message) { // RPL_SERVICEINFO
      serverMessage.call(this, message);
    },
    "232": function(message) { // RPL_ENDOFSERVICES
      serverMessage.call(this, message);
    },
    "233": function(message) { // RPL_SERVICE
      // Non-generic
      serverMessage.call(this, message);
    },

    /*
     * Server
     */
    "234": function(message) { // RPL_SERVLIST
      // <name> <server> <mask> <type> <hopcount> <info>
      serverMessage.call(this, message);
    },
    "235": function(message) { // RPL_SERVLISTEND
      // <mask> <type> :End of service listing
      serverMessageEnd.call(this, message);
    },

    /*
     * Stats
     * XXX some of these have real information?
     */
    "240": function(message) { // RPL_STATSVLINE
      serverMessage.call(this, message);
    },
    "241": function(message) { // RPL_STATSLLINE
      // Non-generic
      serverMessage.call(this, message);
    },
    "242": function(message) { // RPL_STATSUPTIME
      // :Server Up %d days %d:%02d:%02d
      serverMessage.call(this, message);
    },
    "243": function(message) { // RPL_STATSOLINE
      // O <hostmask> * <name>
      serverMessage.call(this, message);
    },
    "244": function(message) { // RPL_STATSHLINE
      serverMessage.call(this, message);
    },
    "245": function(message) { // RPL_STATSSLINE
      // Non-generic
      serverMessage.call(this, message);
    },
    "246": function(message) { // RPL_STATSPING
      serverMessage.call(this, message);
    },
    "247": function(message) { // RPL_STATSBLINE
      serverMessage.call(this, message);
    },
    "250": function(message) { // RPL_STATSDLINE
      // Non-generic
      serverMessage.call(this, message);
    },

    /*
     * LUSER messages
     */
    "251": function(message) { // RPL_LUSERCLIENT
      // :There are <integer> users and <integer> services on <integer> servers
      serverMessage.call(this, message);
    },
    "252": function(message) { // RPL_LUSEROP, 0 if not sent
      // <integer> :operator(s) online
      serverMessage.call(this, message);
    },
    "253": function(message) { // RPL_LUSERUNKNOWN, 0 if not sent
      // <integer> :unknown connection(s)
      serverMessage.call(this, message);
    },
    "254": function(message) { // RPL_LUSERCHANNELS, 0 if not sent
      // <integer> :channels formed
      serverMessage.call(this, message);
    },
    "255": function(message) { // RPL_LUSERME
      // :I have <integer> clients and <integer> servers
      serverMessage.call(this, message);
    },

    /*
     * ADMIN messages
     */
    "256": function(message) { // RPL_ADMINME
      // <server> :Administrative info
      serverMessage.call(this, message);
    },
    "257": function(message) { // RPL_ADMINLOC1
      // :<admin info>
      // City, state & country
      serverMessage.call(this, message);
    },
    "258": function(message) { // RPL_ADMINLOC2
      // :<admin info>
      // Institution details
      serverMessage.call(this, message);
    },
    "259": function(message) { // RPL_ADMINEMAIL
      // :<admin info>
      // XXX parse this for a contact email?
      serverMessage.call(this, message);
    },

    /*
     * TRACELOG
     */
    "261": function(message) { // RPL_TRACELOG
      // File <logfile> <debug level>
      serverMessage.call(this, message);
    },
    "262": function(message) { // RPL_TRACEEND
      // <server name> <version & debug level> :End of TRACE
      serverMessageEnd.call(this, message);
    },

    /*
     * Try again
     */
    "263": function(message) { // RPL_TRYAGAIN
      // <command> :Please wait a while and try again.
      // XXX setTimeout for a minute or so and try again?
    },

    /*
     *
     */
    "265": function(message) { // XXX nonstandard
      // :Current Local Users: <integer>  Max: <integer>
      serverMessage.call(this, message);
    },
    "266": function(message) { // XXX nonstandard
      // :Current Global Users: <integer>  Max: <integer>
      serverMessage.call(this, message);
    },
    /*"300": function(message) { // RPL_NONE
      // XXX This is also something else, see below
      // Non-generic
      serverMessage.call(this, message);
    },*/

    /*
     * Status messages
     */
    "301": function(message) { // RPL_AWAY
      // <nick> :<away message>
      this._getConversation(message.params[0]).writeMessage(
        message.params[0],
        message.params[1],
        {autoResponse: true}
      );
      // XXX set user as away on buddy list / conversation lists
    },
    "302": function(message) { // RPL_USERHOST
      // :*1<reply> *( " " <reply )"
      // reply = nickname [ "*" ] "=" ( "+" / "-" ) hostname
      // XXX Can tell op / away from this
    },
    "303": function(message) { // RPL_ISON
      // :*1<nick> *( " " <nick> )"
      // XXX Need to update the buddy list once that's implemented
    },
    "305": function(message) { // RPL_NOAWAY
      // :You are no longer marked as being away
      // XXX Update buddy list / conversation lists
    },
    "306": function(message) { // RPL_NOWAWAY
      // :You have been marked as away
      // XXX Update buddy list / conversation lists
    },

    /*
     * WHOIS
     */
    "311": function(message) { // RPL_WHOISUSER
      // <nick> <user> <host> * :<real name>
      // XXX update user info
    },
    "312": function(message) { // RPL_WHOISSERVER
      // <nick> <server> :<server info>
      // XXX update server info? Do nothing? Why would we ever receive this?
    },
    "313": function(message) { // RPL_WHOISOPERATOR
      // <nick> :is an IRC operator
      // XXX update UI with operator status
    },
    "314": function(message) { // RPL_WHOWASUSER
      // <nick> <user> <host> * :<real name>
      // XXX user isn't online anyway, so do we care?
    },
    "315": function(message) { // RPL_ENDOFWHO
      // <name> :End of WHO list
      // XXX
    },
    "300": function(message) { // RPL_WHOISCHANOP
      // Non-generic
    },
    "317": function(message) { // RPL_WHOISIDLE
      // <nick> <integer> :seconds idle
      // XXX update UI with user's idle status
    },
    "318": function(message) { // RPL_ENDOFWHOIS
      // <nick> :End of WHOIS list
    },
    "319": function(message) { // RPL_WHOISCHANNELS
      // <nick> :*( ( "@" / "+" ) <channel> " " )
      // XXX update UI with voice or operator status
    },

    /*
     * LIST
     */
    "321": function(message) { // RPL_LISTSTART
      // Obsolete. Not used.
    },
    "322": function(message) { // RPL_LIST
      // <channel> <# visible> :<topic>
      // XXX parse this for # users & topic
      this._getConversation(message.source).writeMessage(
        message.source,
        message.params.join(" "),
        {system: true}
      );
    },
    "323": function(message) { // RPL_LISTEND
      // :End of LIST
    },

    /*
     * Channel functions
     */
    "324": function(message) { // RPL_CHANNELMODEIS
      // <channel> <mode> <mode params>
      // XXX parse this and have the UI respond accordingly
    },
    "325": function(message) { // RPL_UNIQOPIS
      // <channel> <nickname>
      // XXX parse this and have the UI respond accordingly
    },
    "331": function(message) { // RPL_NOTOPIC
      // <channel> :No topic is set
      // XXX Do nothing I think?
    },
    "332": function(message) { // RPL_TOPIC
      // <channel> :topic
      // Update the topic UI
      let conversation = this._getConversation(message.params[1]);
      conversation.setTopic(message.params[2]);
      // Send the message
      var topicMessage = "The topic for " + conversation.name + " is : " +
                 message.params[2];
      conversation.writeMessage(null, topicMessage, {system: true});
    },
    "333": function(message) { // XXX nonstandard
    },

    /*
     * Invitations
     */
    "341": function(message) { // RPL_INVITING
      // <channel> <nick>
      // XXX invite successfully sent? Display this?
      this._getConversation(message.source).writeMessage(
        message.source,
        message.params[1] + " was successfully invited to " +
        message.params[0] + "."
      );
    },
    "342": function(message) { // RPL_SUMMONING
      // <user> :Summoning user to IRC
      this._getConversation(message.source).writeMessage(
        message.source,
        message.params[0] + " was summoned."
      );
    },
    "346": function(message) { // RPL_INVITELIST
      // <chanel> <invitemask>
      // XXX what do we do?
    },
    "347": function(message) { // RPL_ENDOFINVITELIST
      // <channel> :End of channel invite list
      // XXX what do we do?
    },
    "348": function(message) { // RPL_EXCEPTLIST
      // <channel> <exceptionmask>
    },
    "349": function(message) { // RPL_ENDOFEXCEPTIONLIST
      // <channel> :End of channel exception list
      // XXX update UI?
    },

    /*
     * Version
     */
    "351": function(message) { // RPL_VERSION
      // <version>.<debuglevel> <server> :<comments>
      serverMessage.call(this, message);
    },

    /*
     * WHO
     */
    "352": function(message) { // RPL_WHOREPLY
      // <channel> <user> <host> <server> <nick> ( "H" / "G" ) ["*"] [ ("@" / "+" ) ] :<hopcount> <real name>
      // XXX
    },

    /*
     * NAMREPLY
     */
    "353": function(message) { // RPL_NAMREPLY
      // <target> ( "=" / "*" / "@" ) <channel> :[ "@" / "+" ] <nick> *( " " [ "@" / "+" ] <nick> )
      // XXX Keep if this is secret (@), private (*) or public (=)
      var conversation = this._getConversation(message.params[2]);
      message.params[3].trim().split(" ").forEach(function(nickname) {
        conversation._getParticipant(nickname);
        //if (!this._buddies[nickname]) // XXX Needs to be put to lower case and ignore the @+ at the beginning
        //  this._buddies[nickname] = {}; // XXX new Buddy()?
      }, this);
    },

    /*
     *
     */
    "361": function(message) { // RPL_KILLDONE
      // XXX
    },
    "362": function(message) { // RPL_CLOSING
      // XXX
    },
    "363": function(message) { // RPL_CLOSEEND
      // Non-generic
      // XXX
    },

    /*
     * Links
     */
    "364": function(message) { // RPL_LINKS
      // <mask> <server> :<hopcount> <server info>
      // XXX
    },
    "365": function(message) { // RPL_ENDOFLINKS
      // <mask> :End of LINKS list
      // XXX
    },

    /*
     * Names
     */
    "366": function(message) { // RPL_ENDOFNAMES
      // <target> <channel> :End of NAMES list
      // Notify of only the ADDED participants
      let conversation = this._getConversation(message.params[1]);
      conversation.notifyObservers(conversation.getParticipants(),
                                   "chat-buddy-add");
    },

    /*
     * End of a bunch of lists
     */
    "367": function(message) { // RPL_BANLIST
      // <channel> <banmask>
      // XXX
    },
    "368": function(message) { // RPL_ENDOFBANLIST
      // <channel> :End of channel ban list
      // XXX
    },
    "369": function(message) { // RPL_ENDOFWHOWAS
      // <nick> :End of WHOWAS
      // XXX
    },

    /*
     * Server info
     */
    "371": function(message) { // RPL_INFO
      // :<string>
      serverMessage.call(this, message);
    },
    "372": function(message) { // RPL_MOTD
      // :- <text>
      if (message.params[1].length > 2) { // Ignore empty messages
        this._getConversation(message.source).writeMessage(
          message.source,
          message.params[1].slice(2),
          {incoming: true}
        );
      }
    },
    "373": function(message) { // RPL_INFOSTART
      // Non-generic
      // XXX
    },
    "374": function(message) { // RPL_ENDOFINFO
      // :End of INFO list
      // XXX
    },
    "375": function(message) { // RPL_MOTDSTART
      // :- <server> Message of the day -
      this._getConversation(message.source).writeMessage(
        message.source,
        message.params[1].slice(2,-2),
        {incoming: true}
      );
    },
    "376": function(message) { // RPL_ENDOFMOTD
      // :End of MOTD command
      // XXX ?
    },

    /*
     * OPER
     */
    "381": function(message) { // RPL_YOUREOPER
      // :You are now an IRC operator
      this._getConversation(message.source).writeMessage(
        message.source,
        message.params[0],
        {system: true}
      );
      // XXX update UI accordingly to show oper status
    },
    "382": function(message) { // RPL_REHASHING
      // <config file> :Rehashing
      this._getConversation(message.source).writeMessage(
        message.source,
        message.params.join(" "),
        {system: true}
      );
    },
    "383": function(message) { // RPL_YOURESERVICE
      // You are service <servicename>
      // XXX Could this ever happen?
    },

    /*
     * Info
     */
    "384": function(message) { // RPL_MYPORTIS
      // Non-generic
    },
    "391": function(message) { // RPL_TIME
      // <server> :<string showing server's local time>
      // XXX parse date string & store or just show it?
    },
    "392": function(message) { // RPL_USERSSTART
      // :UserID   Terminal  Host
      // XXX
    },
    "393": function(message) { // RPL_USERS
      // :<username> <ttyline> <hostname>
      // XXX store into buddy list
    },
    "394": function(message) { // RPL_ENDOFUSERS
      // :End of users
      // XXX Notify observers of the buddy list
    },
    "395": function(message) { // RPL_NOUSERS
      // :Nobody logged in
      // XXX clear buddy list
    },

      // Error messages, Implement Section 5.2 of RFC 2812
    "401": function(message) { // ERR_NOSUCHNICK
      // <nickname> :No such nick/channel
      // XXX
    },
    "402": function(message) { // ERR_NOSUCHSERVER
      // <server name> :No such server
      // XXX
    },
    "403": function(message) { // ERR_NOSUCHCHANNEL
      // <channel name> :No such channel
      this._getConversation(message.source).writeMessage(
        message.source,
        message.params[1] + ": " + message.params[0],
        {error: true}
      );
    },
    "404": function(message) { // ERR_CANNONTSENDTOCHAN
      // <channel name> :Cannot send to channel
      // XXX handle that the channel didn't receive the message
    },
    "405": function(message) { // ERR_TOOMANYCHANNELS
      // <channel name> :You have joined too many channels
      this._getConversation(message.source).writeMessage(
        message.source,
        message.params[1] + ": function(message) { " + message.params[0],
        {error: true}
      );
    },
    "406": function(message) { // ERR_WASNOSUCHNICK
      // <nickname> :There was no such nickname
      // XXX Error saying the nick never existed
    },
    "407": function(message) { // ERR_TOOMANYTARGETS
      // <target> :<error code> recipients. <abord message>
      // XXX
    },
    "408": function(message) { // ERR_NOSUCHSERVICE
      // <service name> :No such service
      // XXX
    },
    "409": function(message) { // ERR_NOORIGIN
      // :No origin specified
      // XXX failed PING/PONG message, this should never occur
    },
    "411": function(message) { // ERR_NORECIPIENT
      // :No recipient given (<command>)
      // XXX This should never happen.
    },
    "412": function(message) { // ERR_NOTEXTTOSEND
      // :No text to send
      // XXX this shouldn't happen?
    },
    "413": function(message) { // ERR_NOTOPLEVEL
      // <mask> :No toplevel domain specified
      // XXX
    },
    "414": function(message) { // ERR_WILDTOPLEVEL
      // <mask> :Wildcard in toplevel domain
      // XXX
    },
    "415": function(message) { // ERR_BADMASK
      // <mask> :Bad Server/host mask
      // XXX
    },
    "421": function(message) { // ERR_UNKNOWNCOMMAND
      // <command> :Unknown command
      // XXX This shouldn't occur
    },
    "422": function(message) { // ERR_NOMOTD
      // :MOTD File is missing
      // XXX
    },
    "423": function(message) { // ERR_NOADMININFO
      // <server> :No administrative info available
      // XXX
    },
    "424": function(message) { // ERR_FILEERROR
      // :File error doing <file op> on <file>
      // XXX
    },
    "431": function(message) { // ERR_NONICKNAMEGIVEN
      // :No nickname given
      // XXX
    },
    "432": function(message) { // ERR_ERRONEUSNICKNAME
      // <nick> :Erroneous nickname
      // XXX Prompt user for new nick? Autoclean characters?
    },
    "433": function(message) { // ERR_NICKNAMEINUSE
      // <nick> :Nickname is already in use
      // XXX should be the same as below
    },
    "436": function(message) { // ERR_NICKCOLLISION
      // <nick> :Nickname collision KILL from <user>@<host>
      // Take the returned nick and increment the last character
      this._nickname = message.params[1].slice(0, -1) +
        String.fromCharCode(
        message.params[1].charCodeAt(message.params[1].length - 1) + 1
        );
      this._sendMessage("NICK", [this._nickname]); // Nick message
      // XXX inform user?
      this._getConversation(message.source).writeMessage(
        message.source,
        "Changing nick to " + this._nickname + " [<i>" + message.params[2] +
        "</i>]."
      );
    },
    "437": function(message) { // ERR_UNAVAILRESOURCE
      // <nick/channel> :Nick/channel is temporarily unavailable
      // XXX
    },
    "441": function(message) { // ERR_USERNOTINCHANNEL
      // <nick> <channel> :They aren't on that channel
      // XXX
    },
    "442": function(message) { // ERR_NOTONCHANNEL
      // <channel> :You're not on that channel
      // XXX
    },
    "443": function(message) { // ERR_USERONCHANNEL
      // <user> <channel> :is already on channel
      // XXX
    },
    "444": function(message) { // ERR_NOLOGIN
      // <user> :User not logged in
      // XXX
    },
    "445": function(message) { // ERR_SUMMONDISABLED
      // :SUMMON has been disabled
      // XXX keep track of this and disable UI associated?
    },
    "446": function(message) { // ERR_USERSDISABLED
      // :USERS has been disabled
      // XXX Disabled all buddy list etc.
    },
    "451": function(message) { // ERR_NOTREGISTERED
      // :You have not registered
      // XXX We shouldn't get this?
    },
    "461": function(message) { // ERR_NEEDMOREPARAMS
      // <command> :Not enough parameters
      // XXX
    },
    "462": function(message) { // ERR_ALREADYREGISTERED
      // :Unauthorized command (already registered)
      // XXX
    },
    "463": function(message) { // ERR_NOPERMFORHOST
      // :Your host isn't among the privileged
      // XXX
    },
    "464": function(message) { // ERR_PASSWDMISMATCH
      // :Password incorrect
      // XXX prompt user for new password
    },
    "465": function(message) { // ERR_YOUREBANEDCREEP
      // :You are banned from this server
      this._getConversation(message.source).writeMessage(
        message.source,
        message.params.join(" "),
        {error: true}
      );
      this.disconnect(); // XXX should show error in account manager
    },
    "466": function(message) { // ERR_YOUWILLBEBANNED
      // :You are banned from this server
      this._getConversation(message.source).writeMessage(
        message.source,
        message.params.join(" "),
        {error: true}
      );
      this.disconnect(); // XXX should show error in account manager
    },
    "467": function(message) { // ERR_KEYSET
      // <channel> :Channel key already set
      // XXX
    },
    "471": function(message) { // ERR_CHANNELISFULL
      // <channel> :Cannot join channel (+l)
      // XXX
    },
    "472": function(message) { // ERR_UNKNOWNMODE
      // <char> :is unknown mode char to me for <channel>
      // XXX
    },
    "473": function(message) { // ERR_INVITEONLYCHAN
      // <channel> :Cannot join channel (+i)
      // XXX
    },
    "474": function(message) { // ERR_BANNEDFROMCHAN
      // <channel> :Cannot join channel (+b)
      // XXX
    },
    "475": function(message) { // ERR_BADCHANNELKEY
      // <channel> :Cannot join channel (+k)
      // XXX need to inform user
    },
    "476": function(message) { // ERR_BADCHANMASK
      // <channel> :Bad Channel Mask
      // XXX
    },
    "477": function(message) { // ERR_NOCHANMODES
      // <channel> :Channel doesn't support modes
      // XXX
    },
    "478": function(message) { // ERR_BANLISTFULL
      // <channel> <char> :Channel list is full
      // XXX
    },
    "481": function(message) { // ERR_NOPRIVILEGES
      // :Permission Denied- You're not an IRC operator
      // XXX ask to auth?
    },
    "482": function(message) { // ERR_CHANOPRIVSNEEDED
      // <channel> :You're not channel operator
      // XXX ask for auth?
    },
    "483": function(message) { // ERR_CANTKILLSERVER
      // :You can't kill a server!
      // XXX?
    },
    "484": function(message) { // ERR_RESTRICTED
      // :Your connection is restricted!
      // Indicates user mode +r
      // XXX
    },
    "485": function(message) { // ERR_UNIQOPPRIVSNEEDED
      // :You're not the original channel operator
      // XXX ask to auth?
      // XXX
    },
    "491": function(message) { // ERR_NOOPERHOST
      // :No O-lines for your host
      // XXX
    },
    "492": function(message) { //ERR_NOSERVICEHOST
      // Non-generic
      // XXX
    },
    "501": function(message) { // ERR_UMODEUNKNOWNFLAGS
      // :Unknown MODE flag
      // XXX could this happen?
    },
    "502": function(message) { // ERR_USERSDONTMATCH
      // :Cannot change mode for other users
      this._getConversation(message.source).writeMessage(
        message.source,
        message.params.join(" "),
        {error: true}
      );
    }
  }
};
