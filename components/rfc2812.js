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
 * The Original Code is the Instantbird messenging client, released 2011.
 *
 * The Initial Developer of the Original Code is
 * Patrick Cloke <clokep@gmail.com>
 * Portions created by the Initial Developer are Copyright (C) 2011
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

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://irc-js/jsProtoHelper.jsm");
Cu.import("resource://irc-js/utils.jsm");

// Some helper functions for very common command results
function serverMessage(aMessage) {
  this._getConversation(aMessage.source).writeMessage(
    aMessage.source,
    aMessage.params.slice(1).join(" "),
    {system: true}
  );
};
function serverMessageEnd(aMessage) {
  this._getConversation(aMessage.source).writeMessage(
    aMessage.source,
    aMessage.params.slice(1, -1).join(" "),
    {system: true}
  );
};

// This contains the implementation for the basic IRC protocol covered by RFCs
// 1459, 2810, 2811, 2812, and 2813
var rfc2812Commands = {
  "ERROR": function(aMessage) {
    // ERROR <error message>
    // Client connection has been terminated

    this._disconnect(); // Notify account manager
    return true;
  },
  "INVITE": function(aMessage) {
    // INVITE  <nickname> <channel>
    // XXX prompt user to join channel
    return false;
  },
  "JOIN": function(aMessage) {
    // JOIN ( <channel> *( "," <channel> ) [ <key> *( "," <key> ) ] ) / "0"
    // Add the buddy to each channel
    for each (let channelName in aMessage.params[0].split(",")) {
      let conversation = this._getConversation(channelName);
      if (normalize(aMessage.nickname) == normalize(this._nickname)) {
        // If you join, clear the participants list to avoid errors w/ repeated
        // participants
        conversation._removeAllParticipants();
      } else {
        // Don't worry about adding ourself, RPL_NAMES takes care of that case
        conversation._getParticipant(aMessage.nickname, true);
        let joinMessage = aMessage.nickname + " [<i>" + aMessage.source +
                          "</i>] entered the room.";
        conversation.writeMessage(aMessage.nickname,
                                  joinMessage,
                                  {system: true});
      }
    }
    return true;
  },
  "KICK": function(aMessage) {
    // KICK <channel> *( "," <channel> ) <user> *( "," <user> ) [<comment>]
    var usersNames = aMessage.params[1].split(",");
    for each (let channelName in aMessage.params[0].split(",")) {
      let conversation = this._getConversation(channelName);
      for each (let username in usersNames) {
        let kickMessage = username + " has been kicked";
        if (aMessage.params.length == 3)
          kickMessage += " [<i>" + aMessage.params[2] + "</i>]";
        kickMessage += ".";
        conversation.writeMessage(aMessage.nickname,
                                  kickMessage,
                                  {system: true});
        conversation._removeParticipant(username, true);
      }
    }
    return true;
  },
  "MODE": function(aMessage) {
    // MODE <nickname> *( ( "+" / "-") *( "i" / "w" / "o" / "O" / "r" ) )
    if (aMessage.params.length >= 3) {
      // Update the mode of a ConvChatBuddy & display in UI
      let conversation = this._getConversation(aMessage.params[0]);
      let convChatBuddy = conversation._getParticipant(aMessage.params[2]);
      convChatBuddy._setMode(aMessage.params[1]);
      let modeMessage = "mode (" + aMessage.params[1] + " " +
                        aMessage.params[2] + ") by " + aMessage.nickname;
      conversation.writeMessage(aMessage.nickname,
                                modeMessage,
                                {system: true});
      conversation.notifyObservers(convChatBuddy, "chat-buddy-update");
    } else {
      // XXX keep track of our mode? Display in UI?
    }
    return true;
  },
  "NICK": function(aMessage) {
    // NICK <nickname>
    for each (let conversation in this._conversations) {
      if (conversation.isChat &&
          conversation._hasParticipant(aMessage.nickname)) {
        // Update the nick in every chat conversation the user is in
        conversation._updateNick(aMessage.nickname, aMessage.params[0]);

        let nickMessage = aMessage.nickname + " is now known as " +
                          aMessage.params[0];
        conversation.writeMessage(aMessage.nickname,
                                  nickMessage,
                                  {system: true});
      } else {
        // XXX need to handle a private conversation also.
      }
    }
    return true;
  },
  "NOTICE": function(aMessage) {
    // NOTICE <msgtarget> <text>
    this._getConversation(aMessage.nickname || aMessage.source).writeMessage(
      aMessage.nickname || aMessage.source,
      aMessage.params[1],
      {incoming: true}
    );
    return true;
  },
  "PART": function(aMessage) {
    // PART <channel> *( "," <channel> ) [ <Part Message> ]
    // Display the message and remove them from the rooms they're in
    for each (let channelName in aMessage.params[0].split(",")) {
      if (!this._hasConversation(channelName))
        continue; // Handle when we closed the window
      let conversation = this._getConversation(channelName);
      let partMessage;
      if (aMessage.nickname == this._nickname)
        partMessage = "You have left the room (Part";
      else
        partMessage = aMessage.nickname + " has left the room (Part";
      // If a part message was included, show it
      if (aMessage.params.length == 2)
        partMessage += ": " + aMessage.params[1];
      partMessage += ").";
      conversation.writeMessage(aMessage.source, partMessage, {system: true});
      conversation._removeParticipant(aMessage.nickname, true);
    }
    return true;
  },
  "PING": function(aMessage) {
    // PING <server1 [ <server2> ]
    // Keep the connection alive
    this._sendMessage("PONG", [aMessage.params[0]]);
    return true;
  },
  "PRIVMSG": function(aMessage) {
    // PRIVMSG <msgtarget> <text to be sent>
    // Display message in conversation
    this._getConversation(isMUCName(aMessage.params[0]) ?
                            aMessage.params[0] : aMessage.nickname)
        .writeMessage(
          aMessage.nickname || aMessage.source,
          aMessage.params[1],
          {incoming: true}
        );
    return true;
  },
  "QUIT": function(aMessage) {
    // QUIT [ < Quit Message> ]
    // Loop over every conversation with the user and display that they quit
    for each (let conversation in this._conversations) {
      if (conversation.isChat &&
          conversation._hasParticipant(aMessage.nickname)) {
        let quitMessage = aMessage.nickname + " has left the room (Quit";
        // If a quit message was included, show it
        if (aMessage.params.length)
          quitMessage += ": " + aMessage.params[0];
        quitMessage += ").";
        conversation.writeMessage(aMessage.source,
                                  quitMessage,
                                  {system: true});
        conversation._removeParticipant(aMessage.nickname, true);
      }
    }
    return true;
  },
  "SQUIT": function(aMessage) {
    // XXX do we need this?
    return false;
  },
  "TOPIC": function(aMessage) {
    // TOPIC <channel> [ <topic> ]
    // Show topic as a message
    // XXX update the topic in the conversation binding
    this._getConversation(aMessage.params[0]).writeMessage(
      aMessage.nickname || aMessage.source,
      aMessage.nickname + " has changed the topic to: " + aMessage.params[1],
      {system: true}
    );
    return true;
  },
  "001": function(aMessage) { // RPL_WELCOME
    // Welcome to the Internet Relay Network <nick>!<user>@<host>
    serverMessage.call(this, aMessage);
    this.base.connected();
    return true;
  },
  "002": function(aMessage) { // RPL_YOURHOST
    // Your host is <servername>, running version <ver>
    // XXX Use the host instead of the user for all the "server" messages?
    serverMessage.call(this, aMessage);
    return true;
  },
  "003": function(aMessage) { // RPL_CREATED
    //This server was created <date>
    // XXX parse this date and keep it for some reason? Do we care?
    serverMessage.call(this, aMessage);
    return true;
  },
  "004": function(aMessage) { // RPL_MYINFO
    // <servername> <version> <available user modes> <available channel modes>
    // XXX parse the available modes, let the UI respond and inform the user
    serverMessage.call(this, aMessage);
    return true;
  },
  "005": function(aMessage) { // RPL_BOUNCE
    // Try server <server name>, port <port number>
    // XXX See ISupport documentation
    serverMessage.call(this, aMessage);
    return true;
  },

  /*
   * Handle response to TRACE message
   */
  "200": function(aMessage) { // RPL_TRACELINK
    // Link <version & debug level> <destination> <next server> V<protocol version> <link updateime in seconds> <backstream sendq> <upstream sendq>
    serverMessage.call(this, aMessage);
    return true;
  },
  "201": function(aMessage) { // RPL_TRACECONNECTING
    // Try. <class> <server>
    serverMessage.call(this, aMessage);
    return true;
  },
  "202": function(aMessage) { // RPL_TRACEHANDSHAKE
    // H.S. <class> <server>
    serverMessage.call(this, aMessage);
    return true;
  },
  "203": function(aMessage) { // RPL_TRACEUNKNOWN
    // ???? <class> [<client IP address in dot form>]
    serverMessage.call(this, aMessage);
    return true;
  },
  "204": function(aMessage) { // RPL_TRACEOPERATOR
    // Oper <class> <nick>
    serverMessage.call(this, aMessage);
    return true;
  },
  "205": function(aMessage) { // RPL_TRACEUSER
    // User <class> <nick>
    serverMessage.call(this, aMessage);
    return true;
  },
  "206": function(aMessage) { // RPL_TRACESERVER
    // Serv <class> <int>S <int>C <server> <nick!user|*!*>@<host|server> V<protocol version>
    serverMessage.call(this, aMessage);
    return true;
  },
  "207": function(aMessage) { // RPL_TRACESERVICE
    // Service <class> <name> <type> <active type>
    serverMessage.call(this, aMessage);
    return true;
  },
  "208": function(aMessage) { // RPL_TRACENEWTYPE
    // <newtype> 0 <client name>
    serverMessage.call(this, aMessage);
    return true;
  },
  "209": function(aMessage) { // RPL_TRACECLASS
    // Class <class> <count>
    serverMessage.call(this, aMessage);
    return true;
  },
  "210": function(aMessage) { // RPL_TRACERECONNECTION
    // Unused.
    serverMessage.call(this, aMessage);
    return true;
  },

  /*
   * Handle stats message
   **/
  "211": function(aMessage) { // RPL_STATSLINKINFO
    // <linkname> <sendq> <sent messages> <sent Kbytes> <received messages> <received Kbytes> <time open>
    serverMessage.call(this, aMessage);
    return true;
  },
  "212": function(aMessage) { // RPL_STATSCOMMAND
    // <command> <count> <byte count> <remote count>
    serverMessage.call(this, aMessage);
    return true;
  },
  "213": function(aMessage) { // RPL_STATSCLINE
    serverMessage.call(this, aMessage);
    return true;
  },
  "214": function(aMessage) { // RPL_STATSNLINE
    serverMessage.call(this, aMessage);
    return true;
  },
  "215": function(aMessage) { // RPL_STATSILINE
    serverMessage.call(this, aMessage);
    return true;
  },
  "216": function(aMessage) { // RPL_STATSKLINE
    serverMessage.call(this, aMessage);
    return true;
  },
  "217": function(aMessage) { // RPL_STATSQLINE
    serverMessage.call(this, aMessage);
    return true;
  },
  "218": function(aMessage) { // RPL_STATSYLINE
    // Non-generic
    serverMessage.call(this, aMessage);
    return true;
  },
  "219": function(aMessage) { // RPL_ENDOFSTATS
    // <stats letter> :End of STATS report
    serverMessage.call(this, aMessage);
    return true;
  },

  /*
   *
   */
  "221": function(aMessage) { // RPL_UMODEIS
    // <user mode string>
    // XXX update the UI accordingly
    return false;
  },

  /*
   * Services
   */
  "231": function(aMessage) { // RPL_SERVICEINFO
    serverMessage.call(this, aMessage);
    return true;
  },
  "232": function(aMessage) { // RPL_ENDOFSERVICES
    serverMessage.call(this, aMessage);
    return true;
  },
  "233": function(aMessage) { // RPL_SERVICE
    // Non-generic
    serverMessage.call(this, aMessage);
    return true;
  },

  /*
   * Server
   */
  "234": function(aMessage) { // RPL_SERVLIST
    // <name> <server> <mask> <type> <hopcount> <info>
    serverMessage.call(this, aMessage);
    return true;
  },
  "235": function(aMessage) { // RPL_SERVLISTEND
    // <mask> <type> :End of service listing
    serverMessageEnd.call(this, aMessage);
    return true;
  },

  /*
   * Stats
   * XXX some of these have real information?
   */
  "240": function(aMessage) { // RPL_STATSVLINE
    serverMessage.call(this, aMessage);
    return true;
  },
  "241": function(aMessage) { // RPL_STATSLLINE
    // Non-generic
    serverMessage.call(this, aMessage);
    return true;
  },
  "242": function(aMessage) { // RPL_STATSUPTIME
    // :Server Up %d days %d:%02d:%02d
    serverMessage.call(this, aMessage);
    return true;
  },
  "243": function(aMessage) { // RPL_STATSOLINE
    // O <hostmask> * <name>
    serverMessage.call(this, aMessage);
    return true;
  },
  "244": function(aMessage) { // RPL_STATSHLINE
    serverMessage.call(this, aMessage);
    return true;
  },
  "245": function(aMessage) { // RPL_STATSSLINE
    // Non-generic
    serverMessage.call(this, aMessage);
    return true;
  },
  "246": function(aMessage) { // RPL_STATSPING
    serverMessage.call(this, aMessage);
    return true;
  },
  "247": function(aMessage) { // RPL_STATSBLINE
    serverMessage.call(this, aMessage);
    return true;
  },
  "250": function(aMessage) { // RPL_STATSDLINE
    // Non-generic
    serverMessage.call(this, aMessage);
    return true;
  },

  /*
   * LUSER messages
   */
  "251": function(aMessage) { // RPL_LUSERCLIENT
    // :There are <integer> users and <integer> services on <integer> servers
    serverMessage.call(this, aMessage);
    return true;
  },
  "252": function(aMessage) { // RPL_LUSEROP, 0 if not sent
    // <integer> :operator(s) online
    serverMessage.call(this, aMessage);
    return true;
  },
  "253": function(aMessage) { // RPL_LUSERUNKNOWN, 0 if not sent
    // <integer> :unknown connection(s)
    serverMessage.call(this, aMessage);
    return true;
  },
  "254": function(aMessage) { // RPL_LUSERCHANNELS, 0 if not sent
    // <integer> :channels formed
    serverMessage.call(this, aMessage);
    return true;
  },
  "255": function(aMessage) { // RPL_LUSERME
    // :I have <integer> clients and <integer> servers
    serverMessage.call(this, aMessage);
    return true;
  },

  /*
   * ADMIN messages
   */
  "256": function(aMessage) { // RPL_ADMINME
    // <server> :Administrative info
    serverMessage.call(this, aMessage);
    return true;
  },
  "257": function(aMessage) { // RPL_ADMINLOC1
    // :<admin info>
    // City, state & country
    serverMessage.call(this, aMessage);
    return true;
  },
  "258": function(aMessage) { // RPL_ADMINLOC2
    // :<admin info>
    // Institution details
    serverMessage.call(this, aMessage);
    return true;
  },
  "259": function(aMessage) { // RPL_ADMINEMAIL
    // :<admin info>
    // XXX parse this for a contact email?
    serverMessage.call(this, aMessage);
    return true;
  },

  /*
   * TRACELOG
   */
  "261": function(aMessage) { // RPL_TRACELOG
    // File <logfile> <debug level>
    serverMessage.call(this, aMessage);
    return true;
  },
  "262": function(aMessage) { // RPL_TRACEEND
    // <server name> <version & debug level> :End of TRACE
    serverMessageEnd.call(this, aMessage);
    return true;
  },

  /*
   * Try again
   */
  "263": function(aMessage) { // RPL_TRYAGAIN
    // <command> :Please wait a while and try again.
    // XXX setTimeout for a minute or so and try again?
    return false;
  },

  /*
   *
   */
  "265": function(aMessage) { // XXX nonstandard
    // :Current Local Users: <integer>  Max: <integer>
    serverMessage.call(this, aMessage);
    return true;
  },
  "266": function(aMessage) { // XXX nonstandard
    // :Current Global Users: <integer>  Max: <integer>
    serverMessage.call(this, aMessage);
    return true;
  },
  "300": function(aMessage) { // RPL_NONE
    // XXX This is also something else, see below
    // Non-generic
    serverMessage.call(this, aMessage);
    return false;
  },

  /*
   * Status messages
   */
  "301": function(aMessage) { // RPL_AWAY
    // <nick> :<away message>
    this._getConversation(aMessage.params[0]).writeMessage(
      aMessage.params[0],
      aMessage.params[1],
      {autoResponse: true}
    );
    // XXX set user as away on buddy list / conversation lists
    return true;
  },
  "302": function(aMessage) { // RPL_USERHOST
    // :*1<reply> *( " " <reply )"
    // reply = nickname [ "*" ] "=" ( "+" / "-" ) hostname
    // XXX Can tell op / away from this
    return false;
  },
  "303": function(aMessage) { // RPL_ISON
    // :*1<nick> *( " " <nick> )"
    // XXX Need to update the buddy list once that's implemented
    return false;
  },
  "305": function(aMessage) { // RPL_NOAWAY
    // :You are no longer marked as being away
    // XXX Update buddy list / conversation lists
    return false;
  },
  "306": function(aMessage) { // RPL_NOWAWAY
    // :You have been marked as away
    // XXX Update buddy list / conversation lists
    return false;
  },

  /*
   * WHOIS
   */
  "311": function(aMessage) { // RPL_WHOISUSER
    // <nick> <user> <host> * :<real name>
    // XXX update user info
    return false;
  },
  "312": function(aMessage) { // RPL_WHOISSERVER
    // <nick> <server> :<server info>
    // XXX update server info? Do nothing? Why would we ever receive this?
    return false;
  },
  "313": function(aMessage) { // RPL_WHOISOPERATOR
    // <nick> :is an IRC operator
    // XXX update UI with operator status
    return false;
  },
  "314": function(aMessage) { // RPL_WHOWASUSER
    // <nick> <user> <host> * :<real name>
    // XXX user isn't online anyway, so do we care?
    return false;
  },
  "315": function(aMessage) { // RPL_ENDOFWHO
    // <name> :End of WHO list
    // XXX
    return false;
  },
  "300": function(aMessage) { // RPL_WHOISCHANOP
    // Non-generic
    return false;
  },
  "317": function(aMessage) { // RPL_WHOISIDLE
    // <nick> <integer> :seconds idle
    // XXX update UI with user's idle status
    return false;
  },
  "318": function(aMessage) { // RPL_ENDOFWHOIS
    // <nick> :End of WHOIS list
    return false;
  },
  "319": function(aMessage) { // RPL_WHOISCHANNELS
    // <nick> :*( ( "@" / "+" ) <channel> " " )
    // XXX update UI with voice or operator status
    return false;
  },

  /*
   * LIST
   */
  "321": function(aMessage) { // RPL_LISTSTART
    // Obsolete. Not used.
    return false;
  },
  "322": function(aMessage) { // RPL_LIST
    // <channel> <# visible> :<topic>
    // XXX parse this for # users & topic
    this._getConversation(aMessage.source).writeMessage(
      aMessage.source,
      aMessage.params.join(" "),
      {system: true}
    );
    return true;
  },
  "323": function(aMessage) { // RPL_LISTEND
    // :End of LIST
    return true;
  },

  /*
   * Channel functions
   */
  "324": function(aMessage) { // RPL_CHANNELMODEIS
    // <channel> <mode> <mode params>
    // XXX parse this and have the UI respond accordingly
    return false;
  },
  "325": function(aMessage) { // RPL_UNIQOPIS
    // <channel> <nickname>
    // XXX parse this and have the UI respond accordingly
    return false;
  },
  "331": function(aMessage) { // RPL_NOTOPIC
    // <channel> :No topic is set
    // XXX Do nothing I think?
    return false;
  },
  "332": function(aMessage) { // RPL_TOPIC
    // <channel> :<topic>
    // Update the topic UI
    let conversation = this._getConversation(aMessage.params[1]);
    conversation.setTopic(aMessage.params[2]);
    // Send the message
    var topicMessage = "The topic for " + conversation.name + " is : " +
                       aMessage.params[2];
    conversation.writeMessage(null, topicMessage, {system: true});
    return true;
  },
  "333": function(aMessage) { // XXX nonstandard
    // <channel> <nickname> <time>
    let conversation = this._getConversation(aMessage.params[1]);
    conversation.setTopic(null, aMessage.params[2]);
    // Send the message
    // Need to convert the time from seconds to milliseconds for JavaScript
    var topicSetterMessage = "The topic for " + conversation.name + " was " +
                             "set by " + aMessage.params[2] + " at " +
                              new Date(parseInt(aMessage.params[3]) * 1000);
    conversation.writeMessage(null, topicSetterMessage, {system: true});
    return true;
  },

  /*
   * Invitations
   */
  "341": function(aMessage) { // RPL_INVITING
    // <channel> <nick>
    // XXX invite successfully sent? Display this?
    this._getConversation(aMessage.source).writeMessage(
      aMessage.source,
      aMessage.params[1] + " was successfully invited to " +
      aMessage.params[0] + "."
    );
    return true;
  },
  "342": function(aMessage) { // RPL_SUMMONING
    // <user> :Summoning user to IRC
    this._getConversation(aMessage.source).writeMessage(
      aMessage.source,
      aMessage.params[0] + " was summoned."
    );
    return true;
  },
  "346": function(aMessage) { // RPL_INVITELIST
    // <chanel> <invitemask>
    // XXX what do we do?
    return false;
  },
  "347": function(aMessage) { // RPL_ENDOFINVITELIST
    // <channel> :End of channel invite list
    // XXX what do we do?
    return false;
  },
  "348": function(aMessage) { // RPL_EXCEPTLIST
    // <channel> <exceptionmask>
    // XXX what do we do?
    return false;
  },
  "349": function(aMessage) { // RPL_ENDOFEXCEPTIONLIST
    // <channel> :End of channel exception list
    // XXX update UI?
    return false;
  },

  /*
   * Version
   */
  "351": function(aMessage) { // RPL_VERSION
    // <version>.<debuglevel> <server> :<comments>
    serverMessage.call(this, aMessage);
    return true;
  },

  /*
   * WHO
   */
  "352": function(aMessage) { // RPL_WHOREPLY
    // <channel> <user> <host> <server> <nick> ( "H" / "G" ) ["*"] [ ("@" / "+" ) ] :<hopcount> <real name>
    // XXX
    return false;
  },

  /*
   * NAMREPLY
   */
  "353": function(aMessage) { // RPL_NAMREPLY
    // <target> ( "=" / "*" / "@" ) <channel> :[ "@" / "+" ] <nick> *( " " [ "@" / "+" ] <nick> )
    // XXX Keep if this is secret (@), private (*) or public (=)
    var conversation = this._getConversation(aMessage.params[2]);
    aMessage.params[3].trim().split(" ").forEach(function(nickname) {
      conversation._getParticipant(nickname);
      //if (!this._buddies[nickname]) // XXX Needs to be put to lower case and ignore the @+ at the beginning
      //  this._buddies[nickname] = {}; // XXX new Buddy()?
    }, this);
    return true;
  },

  /*
   *
   */
  "361": function(aMessage) { // RPL_KILLDONE
    // XXX
    return false;
  },
  "362": function(aMessage) { // RPL_CLOSING
    // XXX
    return false;
  },
  "363": function(aMessage) { // RPL_CLOSEEND
    // Non-generic
    // XXX
    return false;
  },

  /*
   * Links
   */
  "364": function(aMessage) { // RPL_LINKS
    // <mask> <server> :<hopcount> <server info>
    // XXX
    return false;
  },
  "365": function(aMessage) { // RPL_ENDOFLINKS
    // <mask> :End of LINKS list
    // XXX
    return false;
  },

  /*
   * Names
   */
  "366": function(aMessage) { // RPL_ENDOFNAMES
    // <target> <channel> :End of NAMES list
    // Notify of only the ADDED participants
    let conversation = this._getConversation(aMessage.params[1]);
    conversation.notifyObservers(conversation.getParticipants(),
                                 "chat-buddy-add");
    return true;
  },

  /*
   * End of a bunch of lists
   */
  "367": function(aMessage) { // RPL_BANLIST
    // <channel> <banmask>
    // XXX
    return false;
  },
  "368": function(aMessage) { // RPL_ENDOFBANLIST
    // <channel> :End of channel ban list
    // XXX
    return false;
  },
  "369": function(aMessage) { // RPL_ENDOFWHOWAS
    // <nick> :End of WHOWAS
    // XXX
    return false;
  },

  /*
   * Server info
   */
  "371": function(aMessage) { // RPL_INFO
    // :<string>
    serverMessage.call(this, aMessage);
    return true;
  },
  "372": function(aMessage) { // RPL_MOTD
    // :- <text>
    if (aMessage.params[1].length > 2) { // Ignore empty messages
      this._getConversation(aMessage.source).writeMessage(
        aMessage.source,
        aMessage.params[1].slice(2),
        {incoming: true}
      );
    }
    return true;
  },
  "373": function(aMessage) { // RPL_INFOSTART
    // Non-generic
    // XXX
    return false;
  },
  "374": function(aMessage) { // RPL_ENDOFINFO
    // :End of INFO list
    // XXX
    return false;
  },
  "375": function(aMessage) { // RPL_MOTDSTART
    // :- <server> Message of the day -
    this._getConversation(aMessage.source).writeMessage(
      aMessage.source,
      aMessage.params[1].slice(2,-2),
      {incoming: true}
    );
    return true;
  },
  "376": function(aMessage) { // RPL_ENDOFMOTD
    // :End of MOTD command
    // XXX ?
    return true;
  },

  /*
   * OPER
   */
  "381": function(aMessage) { // RPL_YOUREOPER
    // :You are now an IRC operator
    this._getConversation(aMessage.source).writeMessage(
      aMessage.source,
      aMessage.params[0],
      {system: true}
    );
    // XXX update UI accordingly to show oper status
    return true;
  },
  "382": function(aMessage) { // RPL_REHASHING
    // <config file> :Rehashing
    this._getConversation(aMessage.source).writeMessage(
      aMessage.source,
      aMessage.params.join(" "),
      {system: true}
    );
    return true;
  },
  "383": function(aMessage) { // RPL_YOURESERVICE
    // You are service <servicename>
    // XXX Could this ever happen?
    return false;
  },

  /*
   * Info
   */
  "384": function(aMessage) { // RPL_MYPORTIS
    // Non-generic
    return false;
  },
  "391": function(aMessage) { // RPL_TIME
    // <server> :<string showing server's local time>
    // XXX parse date string & store or just show it?
    return false;
  },
  "392": function(aMessage) { // RPL_USERSSTART
    // :UserID   Terminal  Host
    // XXX
    return false;
  },
  "393": function(aMessage) { // RPL_USERS
    // :<username> <ttyline> <hostname>
    // XXX store into buddy list
    return false;
  },
  "394": function(aMessage) { // RPL_ENDOFUSERS
    // :End of users
    // XXX Notify observers of the buddy list
    return false;
  },
  "395": function(aMessage) { // RPL_NOUSERS
    // :Nobody logged in
    // XXX clear buddy list
    return false;
  },

    // Error messages, Implement Section 5.2 of RFC 2812
  "401": function(aMessage) { // ERR_NOSUCHNICK
    // <nickname> :No such nick/channel
    // XXX
    return false;
  },
  "402": function(aMessage) { // ERR_NOSUCHSERVER
    // <server name> :No such server
    // XXX
    return false;
  },
  "403": function(aMessage) { // ERR_NOSUCHCHANNEL
    // <channel name> :No such channel
    this._getConversation(aMessage.source).writeMessage(
      aMessage.source,
      aMessage.params[1] + ": " + aMessage.params[0],
      {error: true}
    );
    return true;
  },
  "404": function(aMessage) { // ERR_CANNONTSENDTOCHAN
    // <channel name> :Cannot send to channel
    // XXX handle that the channel didn't receive the message
    return false;
  },
  "405": function(aMessage) { // ERR_TOOMANYCHANNELS
    // <channel name> :You have joined too many channels
    this._getConversation(aMessage.source).writeMessage(
      aMessage.source,
      aMessage.params[1] + ": function(aMessage) { " + aMessage.params[0],
      {error: true}
    );
    return true;
  },
  "406": function(aMessage) { // ERR_WASNOSUCHNICK
    // <nickname> :There was no such nickname
    // XXX Error saying the nick never existed
    return false;
  },
  "407": function(aMessage) { // ERR_TOOMANYTARGETS
    // <target> :<error code> recipients. <abord message>
    // XXX
    return false;
  },
  "408": function(aMessage) { // ERR_NOSUCHSERVICE
    // <service name> :No such service
    // XXX
    return false;
  },
  "409": function(aMessage) { // ERR_NOORIGIN
    // :No origin specified
    // XXX failed PING/PONG message, this should never occur
    return false;
  },
  "411": function(aMessage) { // ERR_NORECIPIENT
    // :No recipient given (<command>)
    // XXX This should never happen.
    return false;
  },
  "412": function(aMessage) { // ERR_NOTEXTTOSEND
    // :No text to send
    // XXX this shouldn't happen?
    return false;
  },
  "413": function(aMessage) { // ERR_NOTOPLEVEL
    // <mask> :No toplevel domain specified
    // XXX
    return false;
  },
  "414": function(aMessage) { // ERR_WILDTOPLEVEL
    // <mask> :Wildcard in toplevel domain
    // XXX
    return false;
  },
  "415": function(aMessage) { // ERR_BADMASK
    // <mask> :Bad Server/host mask
    // XXX
    return false;
  },
  "421": function(aMessage) { // ERR_UNKNOWNCOMMAND
    // <command> :Unknown command
    // XXX This shouldn't occur
    return false;
  },
  "422": function(aMessage) { // ERR_NOMOTD
    // :MOTD File is missing
    // XXX
    return false;
  },
  "423": function(aMessage) { // ERR_NOADMININFO
    // <server> :No administrative info available
    // XXX
    return false;
  },
  "424": function(aMessage) { // ERR_FILEERROR
    // :File error doing <file op> on <file>
    // XXX
    return false;
  },
  "431": function(aMessage) { // ERR_NONICKNAMEGIVEN
    // :No nickname given
    // XXX
    return false;
  },
  "432": function(aMessage) { // ERR_ERRONEUSNICKNAME
    // <nick> :Erroneous nickname
    // XXX Prompt user for new nick? Autoclean characters?
    return false;
  },
  "433": function(aMessage) { // ERR_NICKNAMEINUSE
    // <nick> :Nickname is already in use
    // XXX should be the same as below
    return false;
  },
  "436": function(aMessage) { // ERR_NICKCOLLISION
    // <nick> :Nickname collision KILL from <user>@<host>
    // Take the returned nick and increment the last character
    this._nickname = aMessage.params[1].slice(0, -1) +
      String.fromCharCode(
      aMessage.params[1].charCodeAt(aMessage.params[1].length - 1) + 1
      );
    this._sendMessage("NICK", [this._nickname]); // Nick message
    // XXX inform user?
    this._getConversation(aMessage.source).writeMessage(
      aMessage.source,
      "Changing nick to " + this._nickname + " [<i>" + aMessage.params[2] +
      "</i>]."
    );
    return true;
  },
  "437": function(aMessage) { // ERR_UNAVAILRESOURCE
    // <nick/channel> :Nick/channel is temporarily unavailable
    // XXX
    return false;
  },
  "441": function(aMessage) { // ERR_USERNOTINCHANNEL
    // <nick> <channel> :They aren't on that channel
    // XXX
    return false;
  },
  "442": function(aMessage) { // ERR_NOTONCHANNEL
    // <channel> :You're not on that channel
    // XXX
    return false;
  },
  "443": function(aMessage) { // ERR_USERONCHANNEL
    // <user> <channel> :is already on channel
    // XXX
    return false;
  },
  "444": function(aMessage) { // ERR_NOLOGIN
    // <user> :User not logged in
    // XXX
    return false;
  },
  "445": function(aMessage) { // ERR_SUMMONDISABLED
    // :SUMMON has been disabled
    // XXX keep track of this and disable UI associated?
    return false;
  },
  "446": function(aMessage) { // ERR_USERSDISABLED
    // :USERS has been disabled
    // XXX Disabled all buddy list etc.
    return false;
  },
  "451": function(aMessage) { // ERR_NOTREGISTERED
    // :You have not registered
    // XXX We shouldn't get this?
    return false;
  },
  "461": function(aMessage) { // ERR_NEEDMOREPARAMS
    // <command> :Not enough parameters
    // XXX
    return false;
  },
  "462": function(aMessage) { // ERR_ALREADYREGISTERED
    // :Unauthorized command (already registered)
    // XXX
    return false;
  },
  "463": function(aMessage) { // ERR_NOPERMFORHOST
    // :Your host isn't among the privileged
    // XXX
    return false;
  },
  "464": function(aMessage) { // ERR_PASSWDMISMATCH
    // :Password incorrect
    // XXX prompt user for new password
    return false;
  },
  "465": function(aMessage) { // ERR_YOUREBANEDCREEP
    // :You are banned from this server
    this._getConversation(aMessage.source).writeMessage(
      aMessage.source,
      aMessage.params.join(" "),
      {error: true}
    );
    this.disconnect(); // XXX should show error in account manager
    return true;
  },
  "466": function(aMessage) { // ERR_YOUWILLBEBANNED
    // :You are banned from this server
    this._getConversation(aMessage.source).writeMessage(
      aMessage.source,
      aMessage.params.join(" "),
      {error: true}
    );
    this.disconnect(); // XXX should show error in account manager
    return true;
  },
  "467": function(aMessage) { // ERR_KEYSET
    // <channel> :Channel key already set
    // XXX
    return false;
  },
  "471": function(aMessage) { // ERR_CHANNELISFULL
    // <channel> :Cannot join channel (+l)
    // XXX
    return false;
  },
  "472": function(aMessage) { // ERR_UNKNOWNMODE
    // <char> :is unknown mode char to me for <channel>
    // XXX
    return false;
  },
  "473": function(aMessage) { // ERR_INVITEONLYCHAN
    // <channel> :Cannot join channel (+i)
    // XXX
    return false;
  },
  "474": function(aMessage) { // ERR_BANNEDFROMCHAN
    // <channel> :Cannot join channel (+b)
    // XXX
    return false;
  },
  "475": function(aMessage) { // ERR_BADCHANNELKEY
    // <channel> :Cannot join channel (+k)
    // XXX need to inform user
    return false;
  },
  "476": function(aMessage) { // ERR_BADCHANMASK
    // <channel> :Bad Channel Mask
    // XXX
    return false;
  },
  "477": function(aMessage) { // ERR_NOCHANMODES
    // <channel> :Channel doesn't support modes
    // XXX
    return false;
  },
  "478": function(aMessage) { // ERR_BANLISTFULL
    // <channel> <char> :Channel list is full
    // XXX
    return false;
  },
  "481": function(aMessage) { // ERR_NOPRIVILEGES
    // :Permission Denied- You're not an IRC operator
    // XXX ask to auth?
    return false;
  },
  "482": function(aMessage) { // ERR_CHANOPRIVSNEEDED
    // <channel> :You're not channel operator
    // XXX ask for auth?
    return false;
  },
  "483": function(aMessage) { // ERR_CANTKILLSERVER
    // :You can't kill a server!
    // XXX?
    return false;
  },
  "484": function(aMessage) { // ERR_RESTRICTED
    // :Your connection is restricted!
    // Indicates user mode +r
    // XXX
    return false;
  },
  "485": function(aMessage) { // ERR_UNIQOPPRIVSNEEDED
    // :You're not the original channel operator
    // XXX ask to auth?
    // XXX
    return false;
  },
  "491": function(aMessage) { // ERR_NOOPERHOST
    // :No O-lines for your host
    // XXX
    return false;
  },
  "492": function(aMessage) { //ERR_NOSERVICEHOST
    // Non-generic
    // XXX
    return false;
  },
  "501": function(aMessage) { // ERR_UMODEUNKNOWNFLAGS
    // :Unknown MODE flag
    // XXX could this happen?
    return false;
  },
  "502": function(aMessage) { // ERR_USERSDONTMATCH
    // :Cannot change mode for other users
    this._getConversation(aMessage.source).writeMessage(
      aMessage.source,
      aMessage.params.join(" "),
      {error: true}
    );
    return true;
  }
};

function rfc2812() { }
rfc2812.prototype = {
  __proto__: ClassInfo("ircISpecification", "RFC 2812 - Basic IRC support"),
  classID:          Components.ID("{f142ddeb-90ca-4606-a08d-ff29cc048f84}"),
  contractID:       "@instantbird.org/irc/rfc2812;1",

  // Parameters
  name: "RFC 2812", // Name identifier
  priority: Ci.ircISpecification.PRIORITY_DEFAULT, // Default RFC 2812 priority

  handle: function(aConv, aMessage) {
    let command = aMessage.command.toUpperCase();
    if (!this._ircCommands.hasOwnProperty(command))
      return false;

    // Make a nice JavaScript object for us to use (instead of the XPCOM
    // object).
    let message = {
      rawMessage: aMessage.rawMessage,
      source: aMessage.source,
      nickname: aMessage.nickname,
      user: aMessage.user,
      host: aMessage.host,
      command: aMessage.command,
      params: enumToArray(aMessage.params)
    };

    LOG(JSON.stringify(message));

    // Parse the command with the JavaScript conversation object as "this".
    this._ircCommands[command].call(ircAccounts[aConv.id], message);
    return true;
  },

  // Object of IRC commands that can be handled.
  _ircCommands: rfc2812Commands,

  // Commands to register with Instantbird
  commands: { }
};

const NSGetFactory = XPCOMUtils.generateNSGetFactory([rfc2812]);
