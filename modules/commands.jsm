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

var EXPORTED_SYMBOLS = ["ircAccounts", "commands"];

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://irc-js/utils.jsm");

// Define some functions that have multiple aliases for commands
function joinCommand(aMsg, aConv) {
  if (aMsg.length) {
    // Get the account
    let account = ircAccounts[aConv.account.id];

    let params = aMsg.split(" ");
    let channels = params[0].split(",");
    let keys = [];

    // Second parameter is the keys/passwords
    if (params.length > 1)
      keys = params[1].split(",");

    // Join each room
    for (let i = 0; i < channels.length; i++) {
      // XXX verify channel is proper string
      params = [channels[i]];

      // If a key was given, used it
      if (keys.length > i)
        params.push(keys[i]);

      // params is (<channel>, [<channel>])
      account._sendMessage("JOIN", params);
    }
    return true;
  }
  return false;
}

// Kick a user from a channel
// aMsg is <user> [comment]
function kickCommand(aMsg, aConv) {
  let params = [];
  let offset = aMsg.indexOf(" ");

  if (aMsg.length) {
    if (offset == -1)
      params = [aMsg];
    else
      params = [aMsg.slice(0, offset), aMsg.slice(offset + 1)];

    // params is (<channel>, <user>, [comment])
    params.unshift(aConv.name);

    ircAccounts[aConv.account.id]._sendMessage("KICK", params);
    return true;
  }
  return false;
}

// Send a message directly to a user
// aMsg is <user> <message>
function messageCommand(aMsg, aConv) {
  if (aMsg.length) {
    let params = aMsg.split(" ");
    if (params.length > 1 && params[1].length)
      return privateMessage(aConv, params[1], params[0]);
  }
  return false;
}

function setMode(aMsg, aConv, aMode, aAddMode) {
  if (aMsg.length) {
    let mode = (!!aAddMode ? "+" : "-") + aMode;
    ircAccounts[aConv.account.id]
               ._sendMessage("MODE", [aNickname, mode]);
    return true;
  }
  return false;
}

// Helper functions
function privateMessage(aConv, aMsg, aNickname) {
  if (aMsg.length) {
    // This will open the conversation, send and display the text
    ircAccounts[aConv.account.id]._getConversation(aNickname).sendMsg(aMsg);
    return true;
  }
  return false;
}
// This will send a command directly where aMsg is the entire parameter
function simpleCommand(aConv, aCommand, aMsg) {
  if (aMsg.length) {
    ircAccounts[aConv.account.id]._sendMessage(aCommand, [aMsg]);
    return true;
  }
  return false;
}

function noParamCommand(aConv, aCommand) {
  ircAccounts[aConv.account.id]._sendMessage(aCommand);
  return true;
}

function ctcpMessage(aConv, aTarget, aCommand, aMessage) {
  if (aMessage.length && aTarget.length) {
    ircAccounts[aConv.account.id]._sendMessage(
      "PRIVMSG", [aTarget, "\001" + aCommand + " " + aMessage + "\001"]);
    return true;
  }
  return false;
}

function targetedMessage(aConv, aCommand, aMessage) {
  let params = aMessage.split(" ");
  if (params.length > 1) {
    params = [params[0], params.slice(1).join(" ")];
    ircAccounts[aConv.account.id]._sendMessage(aCommand, params);
    return true;
  }
  return false;
}

var commands = [
  {
    name: "action",
    helpString: "action <action to perform>:  Perform an action.",
    run: function(aMsg, aConv) ctcpMessage(aConv, aConv.name, "ACTION", aMsg)
  },
  // XXX away -- isn't this handled by core anyway?
  /*{
    name: "away",
    helpString: "away [message]:  Set an away message, or use no message to " +
                "return from being away.",
    run: function(aMsg, aConv) { }
  },*/
  {
    name: "ctcp",
    helpString: "ctcp <nick> <msg>:  Sends ctcp msg to nick.",
    run: function(aMsg, aConv)
      simpleCommand(aConv, "PRIVMSG", "\001" + aMsg + "\001")
  },
  {
    name: "chanserv",
    helpString: "chanserv <command>:  Send a command to the ChanServ.",
    run: function(aMsg, aConv) privateMessage(aConv, aMsg, "ChanServ")
  },
  {
    name: "deop",
    helpString: "deop <nick1> [nick2] ...: Remove channel operator status " +
                "from someone. You must be a channel operator to do this.",
    run: function(aMsg, aConv) setMode(aMsg, aConv, "o", false)
  },
  {
    name: "devoice",
    helpString: "devoice <nick1> [nick2] ...: Remove channel voice status " +
                "from someone, preventing them from speaking if the channel " +
                "is moderated (+m). You must be a channel operator to do this.",
    run: function(aMsg, aConv) setMode(aMsg, aConv, "v", false)
  },
  {
    name: "invite",
    helpString: "invite <nick> [room]: Invite someone to join you in the " +
                "specified channel, or the current channel.",
    run: function(aMsg, aConv) targetedMessage(aConv, "INVITE", aMsg)
  },
  {
    name: "j",
    helpString: "j <room1>[,room2][,...] [key1[,key2][,...]]:  Enter one or " +
                "more channels, optionally providing a channel key for each " +
                "if needed.",
    run: joinCommand
  },
  {
    name: "join",
    helpString: "join <room1>[,room2][,...] [key1[,key2][,...]]:  Enter one " +
                "or more channels, optionally providing a channel key for " +
                "each if needed.",
    run: joinCommand
  },
  {
    name: "kick",
    helpString: "kick <nick> [message]: 	Remove someone from a channel. You " +
                "must be a channel operator to do this.",
    run: kickCommand
  },
  {
    name: "list",
    helpString: "list:  Display a list of chat rooms on the network. " +
                "Warning, some servers may disconnect you upon doing this.",
    run: function(aMsg, aConv) noParamCommand("LIST")
  },
  {
    name: "me",
    helpString: "me <action to perform>:  Perform an action.",
    run: function(aMsg, aConv) {
      if (ctcpMessage(aConv, aConv.name, "ACTION", aMsg)) {
        // Show the action on our conversation
        let account = ircAccounts[aConv.account.id];
        account._getConversation(aConv.name)
               .writeMessage(account._nickname, "/me " + aMsg,
                             {outgoing: true});
        return true;
      }
      return false;
    }
  },
  {
    name: "memoserv",
    helpString: "memoserv <command>:  Send a command to the MemoServ.",
    run: function(aMsg, aConv) privateMessage(aConv, aMsg, "MemoServ")
  },
  {
    name: "mode",
    helpString: "mode &lt;nick|channel&gt; &lt;+|-&gt;&lt;A-Za-z&gt;:  Set " +
                "or unset a channel or user mode.",
    run: function(aMsg, aConv) targetedMessage(aConv, "MODE", aMsg)
  },
  {
    name: "msg",
    helpString: "msg <nick> <message>:  Send a private message to a user (as " +
                "opposed to a channel).",
    run: messageCommand
  },
  // XXX all this does is force the UI to reload the names...which shouldn't be
  // out of date
  /*{
    name: "names",
    helpString: "names [channel]:  List the users currently in a channel.",
    run: function(aMsg, aConv)
      simpleCommand(aConv, "NAMES", aMsg || aConv.account.name)
  },*/
  {
    name: "nick",
    helpString: "nick &lt;new nickname&gt;:  Change your nickname.",
    run: function(aMsg, aConv) {
      // Ensure the new nick is a valid nickname
      if (isNickName(aMsg)) {
        ircAccounts[aConv.account.id]._sendMessage("NICK", [aMsg]);
        return true;
      }
      // XXX error message on bad nick?
      return false;
    }
  },
  {
    name: "nickserv",
    helpString: "nickserv <command>:  Send a command to the NickServ.",
    run: function(aMsg, aConv) privateMessage(aConv, aMsg, "NickServ")
  },
  {
    name: "notice",
    helpString: "notice &lt;target&gt; &lt;message&gt;:  Send a notice to a user or channel.",
    run: function(aMsg, aConv) targetedMessage(aConv, "NOTICE", aMsg)
  },
  {
    name: "op",
    helpString: "op &lt;nick1&gt; [nick2] ... 	Grant channel operator status to " +
                "someone. You must be a channel operator to do this.",
    run: function(aMsg, aConv) setMode(aMsg, aConv, "o", true)
  },
  {
    name: "operwall",
    helpString: "operwall &lt;message&gt;:  If you don't know what this is, you " +
                "probably can't use it (sends a command to all connected " +
                "with the +w flag and all operators on the server.",
    run: function(aMsg, aConv) simpleCommand(aConv, "WALLOPS", aMsg)
  },
  {
    name: "operserv",
    helpString: "operserv &lt;command&gt;:  Send a command to the OperServ.",
    run: function(aMsg, aConv) privateMessage(aConv, aMsg, "OperServ")
  },
  {
    name: "part",
    helpString: "part [room [message]]:  Leave the current channel, or a " +
                "specified channel, with an optional message.",
    run: function(aMsg, aConv) {
      let params = [];
      let offset = aMsg.indexOf(" ");

      if (!aMsg.length)
        params.unshift(aConv.name);
      else if (offset != -1)
        params = [aMsg.slice(0, offset), aMsg.slice(offset + 1)];
      else
        params = [aMsg];

      ircAccounts[aConv.account.id]._sendMessage("PART", params);
      return true;
    }
  },
  {
    name: "ping",
    helpString: "ping [nick]:  Asks how much lag a user (or the server if no " +
                "user specified) has.",
    run: function(aMsg, aConv) {
      if (aMsg.length)
        return ctcpMessage(aConv, aMsg, "PING", "");
      // XXX
      // return simpleCommand(aConv, "PING", ircAccounts[aConv.account.id].)
      return false; // XXX remove this
    }
  },
  {
    name: "query",
    helpString: "query <nick> <message>:  Send a private message to a user " +
                "(as opposed to a channel).",
    run: messageCommand
  },
  {
    name: "quit",
    helpString: "quit [message]:  Disconnect from the server, with an " +
                "optional message.",
    run: function(aMsg, aConv)
      (aMsg.length) ? simpleCommand(aConv, "QUIT", aMsg) :
        noParamCommand(aConv, "QUIT")
  },
  {
    name: "quote",
    helpString: "quote <command>:  Send a raw command to the server.",
    run: function(aMsg, aConv)  {
      if (aMsg.length) {
        ircAccounts[aConv.account.id]._sendMessage(aMsg);
        return true;
      }
      return false;
    }
  },
  {
    name: "remove",
    helpString: "remove <nick> [message]:  Remove someone from a room. You " +
                "must be a channel operator to do this.",
    run: kickCommand
  },
  {
    name: "time",
    helpString: "time:  Displays the current local time at the IRC server.",
    run: function(aMsg, aConv) noParamCommand("TIME")
  },
  {
    name: "topic",
    helpString: "topic [new topic]:  View or change the channel topic.",
    run: function(aMsg, aConv) simpleCommand(aConv, "TOPIC", aMsg)
  },
  {
    name: "umode",
    helpString: "umode &lt;+|-&gt;&lt;A-Za-z&gt;:  Set or unset a user mode.",
    run: function(aMsg, aConv) simpleCommand(aConv, "MODE", aMsg)
  },
  {
    name: "version",
    helpString: "version [nick]:  Send CTCP VERSION request to a user.",
    run: function(aMsg, aConv) ctcpMessage(aConv, aMsg, "VERSION", "")
  },
  {
    name: "voice",
    helpString: "voice <nick1> [nick2] ...:  Grant channel voice status to " +
                "someone. You must be a channel operator to do this.",
    run: function(aMsg, aConv) setMode(aMsg, aConv, "v", true)
  },
  {
    name: "wallops",
    helpString: "wallops <message>:  If you don't know what this is, you " +
                "probably can't use it (sends a command to all connected " +
                "with the +w flag and all operators on the server.",
    run: function(aMsg, aConv) simpleCommand(aConv, "WALLOPS", aMsg)
  },
  {
    name: "whois",
    helpString: "whois [server] <nick>:  Get information on a user.",
    run: function(aMsg, aConv) {
      if (aMsg.length) {
        let params = aMsg.split(" ");
        ircAccounts[aConv.account.id]._sendMessage("WHOIS", params);
        return true;
      }
      return false;
    }
  },
  {
    name: "whowas",
    helpString: "whowas <nick>:  Get information on a user that has logged " +
                "off.",
    run: function(aMsg, aConv) simpleCommand(aConv, "WHOWAS", aMsg)
  }
];
