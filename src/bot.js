// Import Requirements
const DiscordJS = require('discord.js')
const fs = require('fs')
const path = require('path')
const ytdl = require('ytdl-core')

// Import Local Dependencies
const YouTubeAPIHandler = require('./YouTubeApiHandler')
const mh = require('./MessageHandler')
const GuildHandler = require('./GuildState')
const VoiceHandler = require('./VoiceHandler')

// Init Config Vars
let cfg, helpfile, blacklist, radiolist

// Load Files
try {
  cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'config.json')), 'utf8')
  helpfile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'help.json')), 'utf8')
  blacklist = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'blacklist.json')), 'utf8')
  radiolist = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'radio_playlists.json')), 'utf8')
} catch (err) {
  if (err) throw err
}

// Object Construction
const bot = new DiscordJS.Client()
const yth = new YouTubeAPIHandler(cfg.youtube_api_key)

// Variable Declaration
let pf = '$'
let guildStates = {}

class ResponseCapturer {
  constructor (options) {
    this.msg = options.msg
    this.senderID = options.senderID
    this.senderTag = options.senderTag
    this.timeout = options.timeout
    this.choices = options.choices
    this.onCapture = options.onCapture
  }

  sendMsg (msgChannel) {
    let options = {
      embed: {
        title: ':notepad_spiral: ❱❱ SELECTION',
        color: 16580431, // Yellow
        description: `${this.msg}\nType **"quit"** to cancel the response selection.`,
        fields: []
      }
    }

    for (let i = 0; i < this.choices.length; i++) {
      options.embed.fields.push({
        name: `[${i + 1}]`,
        value: this.choices[i]
      })
    }

    msgChannel.send(this.senderTag, options)
  }

  registerResult (res) {
    this.onCapture(res - 1)
    this.removeTimeout()
  }

  removeTimeout () {
    clearTimeout(this.timeout)
  }
}

/*
// Main Bot Process
*/

// Init Bot
bot.login(cfg.bot_token)

// On: Bot ready
bot.on('ready', () => {
  console.log('BOT >> Music Bot started')
  bot.user.setPresence({ game: { name: `v${cfg.version} - By CF12`, type: 0 } })
})

// On: Message Creation
bot.on('message', (msg) => {
  /*
   * TODO: Temporary DJ's
   * TODO: Fix Queue Listings for Radio Mode
   */

  // Cancels messages if user is bot
  if (msg.author.bot) return

  let guildId = msg.guild.id

  // Set up guild state
  if (!guildStates[guildId]) {
    guildStates[guildId] = {
      guildHandler: new GuildHandler(guildId),
      voiceHandler: new VoiceHandler(msg.channel, blacklist, cfg.youtube_api_key)
    }
  }

  let guildHandler = guildStates[guildId].guildHandler
  let voiceHandler = guildStates[guildId].voiceHandler
  let responseState = guildHandler.getGuildResponseCapturer()
  let searchResultState = guildHandler.getGuildSearchResults()

  // Update Msg Channel for voiceHandler
  voiceHandler.updateMsgChannel(msg.channel)

  // Response Capturer for user prompts
  if (responseState.handler) {
    if (responseState.handler.senderID !== msg.member.id) return
    if (responseState.count === 3) {
      guildHandler.resetResponseCapturer(msg.guild.id)
      responseState.handler.removeTimeout()
      mh.logChannel(guildHandler.msgChannel, 'info', 'Cancelling response... [Too many responses]')
      return
    }

    try {
      if (msg.content.toUpperCase() === 'QUIT') {
        guildHandler.resetResponseCapturer(msg.guild.id)
        responseState.handler.removeTimeout()
        mh.logChannel(guildHandler.msgChannel, 'info', 'Cancelling response...')
        return
      } else if (responseState.handler.choices[parseInt(msg.content) - 1]) {
        responseState.handler.registerResult(parseInt(msg.content))
        guildHandler.resetResponseCapturer(msg.guild.id)
        return
      } else {
        responseState.count++
        mh.logChannel(guildHandler.msgChannel, 'err', 'Invalid response! Please use a valid number in your response. Type "quit" if you wish to cancel the prompt')
        return
      }
    } catch (err) {
      if (err) {
        responseState.count++
        mh.logChannel(guildHandler.msgChannel, 'err', 'Invalid response! Please use a valid number in your response. Type "quit" if you wish to cancel the prompt')
        return
      }
    }

    return
  }

  // Cancels messages if no command prefix is detected
  if (!msg.content.startsWith(pf)) return

  // Command variables
  let msgChannel = msg.channel
  let member = msg.member
  let fullMsg = msg.content.split(' ')
  let cmd = fullMsg[0].slice(1, fullMsg[0].length).toUpperCase()
  let args = fullMsg.slice(1, fullMsg.length)

  // Voice Functions
  function queueTrack (sourceID) {
    voiceHandler.addTrack(sourceID, msg.member, false)
      .then(() => {
        if (!voiceHandler.voiceConnection) voiceHandler.voiceConnect(member.voiceChannel)
      })
      .catch((err) => {
        if (err === 'EMPTY_VID') mh.logChannel(msgChannel, 'err', 'This video appears to be invalid / empty. Please double check the URL.')
        else {
          mh.logConsole('err', err)
          mh.logChannel(msgChannel, 'err', 'An unknown error has occured while parsing the link througuildHandler the YouTube API. Please make sure the URL is valid. If all else fails, contact @CF12#1240.')
        }
      })
  }

  function queuePlaylist (sourceID) {
    voiceHandler.addPlaylist(sourceID, member)
      .then(() => {
        mh.logChannel(msgChannel, 'info', 'Playlist successfully added!')
        if (!voiceHandler.voiceConnection) voiceHandler.voiceConnect(member.voiceChannel)
      })
      .catch((err) => {
        if (err === 'EMPTY_VID') mh.logChannel(msgChannel, 'err', 'This video appears to be invalid / empty. Please double check the URL.')
        else {
          mh.logConsole('err', err)
          mh.logChannel(msgChannel, 'err', 'An unknown error has occured while parsing the link througuildHandler the YouTube API. Please make sure the URL is valid. If all else fails, contact @CF12#1240.')
        }
      })
  }

  // Function: Check and return cooldowns between message timestamps
  function checkCooldown (currentTime, lastTime, cooldown) {
    let diff = currentTime - lastTime
    if (diff <= cooldown) {
      mh.logChannel(msgChannel, 'delay', `${msg.member.toString()}, please wait **${cooldown * 0.001 - Math.ceil(diff * 0.001)}** second(s) before using this command again.`)
      return true
    } else {
      guildHandler.lastMsgTimestamp = currentTime
      return false
    }
  }

  // Command: Help
  if (cmd === 'HELP') {
    let options = {
      title: '',
      description: `[] = **required** arguments, {} = **optional** arguments\nUse **${pf}help [command]** for more details regarding that command. `,
      color: 4322503,
      fields: [],
      footer: {
        text: `v${cfg.version} - Developed By @CF12#1240 - https://github.com/CF12/music-bot`,
        icon_url: 'http://i.imgur.com/OAqzbEI.png'
      }
    }

    if (args.length === 0) {
      options.title = ':grey_question: ❱❱ COMMAND HELP'

      for (let key in helpfile) {
        options.fields.push({
          name: `**${pf}${helpfile[key].format}**`,
          value: helpfile[key].description
        })
      }
    } else if (args.length === 1) {
      let input = args[0].toLowerCase()

      if (!Object.keys(helpfile).includes(input)) return mh.logChannel(msgChannel, 'err', `Couldn't find help entry for **${pf}${input}**`)
      else {
        options.title = `:grey_question: ❱❱ COMMAND HELP - ${pf}${input}`
        options.fields = [
          {
            name: 'Usage',
            value: pf + helpfile[input].format
          },
          {
            name: 'Detailed Description',
            value: helpfile[input].long_description
          }
        ]
      }
    }

    msgChannel.send({ embed: options })
    return
  }

  // Command: Ping
  if (cmd === 'PING') return mh.logChannel(msgChannel, 'info', 'Pong!')

  // Command: Play from YouTube Link
  if (cmd === 'PLAY') {
    if (!member.voiceChannel) return mh.logChannel(msgChannel, 'err', 'User is not in a voice channel!')
    if (args.length === 0) return mh.logChannel(msgChannel, 'info', 'Adds a YouTube link to the playlist. Usage: *' + pf + 'play [url]*')
    if (args.length > 1) return mh.logChannel(msgChannel, 'err', 'Invalid usage! Usage: ' + pf + 'play [url]')
    if (blacklist.users.includes(member.id)) return mh.logChannel(msgChannel, 'bl', 'User is blacklisted!')
    if (voiceHandler.radioMode) return mh.logChannel(msgChannel, 'err', 'Songs cannot be queued while the bot is in radio mode!')

    // Message Cooldown Checking
    if (checkCooldown(msg.createdTimestamp, guildHandler.lastMsgTimestamp, 5000)) return

    if (searchResultState.length) {
      let arg = parseInt(args[0])
      if (!isNaN(arg) && isFinite(arg) && arg > 0 && arg <= searchResultState.length) {
        switch (searchResultState[arg - 1].id.kind) {
          case 'youtube#video':
            queueTrack(searchResultState[arg - 1].id.videoId)
            break
          case 'youtube#playlist':
            queuePlaylist(searchResultState[arg - 1].id.playlistId)
            break
          default: throw new Error('Invalid search result item type in YT type handler for play command')
        }
        return
      }
    }

    voiceHandler.parseYTUrl(args[0])
    .then((data) => {
      switch (data.type) {
        case 'video':
          queueTrack(data.id)
          break
        case 'playlist':
          queuePlaylist(data.id)
          break
        case 'hybrid':
          guildHandler.setGuildResponseCapturer({
            count: 0,
            handler: new ResponseCapturer({
              msg: 'Hybrid Video / Playlist link detected. Please choose the desired action:',
              choices: ['Queue video', 'Queue entire playlist'],
              senderID: member.id,
              senderTag: member.toString(),
              timeout: setTimeout(() => {
                guildHandler.resetResponseCapturer(msg.guild.id)
                mh.logChannel(msgChannel, 'info', 'Cancelling response... [Timed out]')
              }, 10000),
              onCapture: (res) => {
                switch (res) {
                  case 0:
                    queueTrack(data.videoID)
                    break
                  case 1:
                    queuePlaylist(data.playlistID)
                    break
                }
              }
            })
          })

          guildHandler.getGuildResponseCapturer(msg.guild.id).handler.sendMsg(msgChannel)
          break
        default:
          throw new Error('Invalid queue type')
      }
    })
    .catch((err) => {
      if (err) mh.logChannel(msgChannel, 'err', 'Error while parsing URL. Please make sure the URL is a valid YouTube link.')
    })
    return
  }

  // Command: Search YouTube for tracks
  if (cmd === 'SEARCH') {
    if (args.length === 0) mh.logChannel(msgChannel, 'err', `Invalid usage! Usage: ${pf}search [phrase]`)
    else {
      yth.search(args.join('+'), 5)
      .then((res) => {
        guildHandler.setGuildSearchResults(res.items)
        let options = {
          title: ':mag: ❱❱ SEARCH RESULTS',
          color: 16007746, // Light Red
          description: `List of results for search phrase: **${args.join(' ')}**`,
          fields: [],
          footer: {
            text: `You can queue a track directly from the search list by using ${pf}play [# of entry]. Example: ${pf}play 2`
          }
        }

        for (let i = 0; i < res.items.length; i++) {
          options.fields.push({
            name: `[${i + 1}] - ${res.items[i].snippet.title}`,
            value: `Uploader: ${res.items[i].snippet.channelTitle} | Type: ${res.items[i].id.kind.split('#')[1]}`
          })
        }

        msgChannel.send({ embed: options })
      })
      .catch((err) => {
        if (err === 'EMPTY_SEARCH') mh.logChannel(msgChannel, 'info', `No results were found for search phrase: **${args.join(' ')}**`)
        else throw err
      })
    }

    return
  }

  // Command: Toggles song shuffling
  if (cmd === 'SHUFFLE') {
    if (args.length > 0) {
      if (['ON', 'TRUE'].includes(args[0].toUpperCase())) voiceHandler.shuffle = true
      else if (['OFF', 'FALSE'].includes(args[0].toUpperCase())) voiceHandler.shuffle = false
      else return mh.logChannel(msgChannel, 'err', `Invalid Arguments! Usage: ${pf + helpfile.shuffle.info.format}`)
    } else voiceHandler.shuffle = !voiceHandler.shuffle

    if (voiceHandler.shuffle) mh.logChannel(msgChannel, 'info', `Shuffling is now: **ON**`)
    else mh.logChannel(msgChannel, 'info', `Shuffling is now: **OFF**`)
    return
  }

  // Command: Requeue last song
  if (cmd === 'REQUEUE') {
    if (!voiceHandler.prevPlayed) return mh.logChannel(msgChannel, 'err', 'Previous Queue is empty. Queue something before using this command.')
    if (checkCooldown(msg.createdTimestamp, guildHandler.lastMsgTimestamp, 5000)) return
    switch (voiceHandler.prevPlayed.type) {
      case 'video':
        voiceHandler.addTrack(voiceHandler.prevPlayed.id, member)
        .then(() => {
          mh.logChannel(msgChannel, 'info', 'Playlist successfully re-queued!')
          if (!voiceHandler.voiceConnection) voiceHandler.voiceConnect(member.voiceChannel)
        })
        break
      case 'playlist':
        voiceHandler.addPlaylist(voiceHandler.prevPlayed.id, member, false)
        .then(() => {
          if (!voiceHandler.voiceConnection) voiceHandler.voiceConnect(member.voiceChannel)
        })
        break
    }
    return
  }

  // Command: List Song Queue
  if (cmd === 'QUEUE') {
    if (voiceHandler.queue.length === 0) return mh.logChannel(msgChannel, 'info', 'Song Queue:\n```' + 'No songs have been queued yet. Use ' + pf + 'play [YouTube URL] to queue a song.' + '```')

    let firstVideoTitle = voiceHandler.queue[0].title
    let firstVideoDuration = voiceHandler.queue[0].duration
    if (firstVideoTitle.length >= 60) firstVideoTitle = firstVideoTitle.slice(0, 55) + ' ...'
    let queue = firstVideoTitle + ' '.repeat(60 - firstVideoTitle.length) + '|' + ' ' + firstVideoDuration + '\n'

    for (let i = 1; i < voiceHandler.queue.length; i++) {
      let videoTitle = voiceHandler.queue[i].title
      let videoDuration = voiceHandler.queue[i].duration

      if (videoTitle.length >= 60) videoTitle = videoTitle.slice(0, 55) + ' ...'
      if (queue.length > 1800) {
        queue = queue + '...and ' + (voiceHandler.queue.length - i) + ' more'
        break
      }

      queue = queue + videoTitle + ' '.repeat(60 - videoTitle.length) + '|' + ' ' + videoDuration + '\n'
    }

    mh.logChannel(msgChannel, 'info', 'Song Queue:\n```' + queue + '```')
    return
  }

  // Command: Skip Song
  if (cmd === 'SKIP') {
    if (!voiceHandler.voiceConnection) return mh.logChannel(msgChannel, 'err', 'The bot is not playing anything currently! Use **' + pf + 'play [url]** to queue a song.')
    if (voiceHandler.radioMode) return mh.logChannel(msgChannel, 'err', 'Skip is unavailable in radio mode.')
    if (checkCooldown(msg.createdTimestamp, guildHandler.lastMsgTimestamp, 5000)) return

    voiceHandler.dispatcher.end()
    return
  }

  // Command: Shows the currently playing song
  if (cmd === 'NP' || cmd === 'NOWPLAYING') {
    if (!voiceHandler.voiceConnection) return mh.logChannel(msgChannel, 'err', 'The bot is not playing anything currently! Use **' + pf + 'play [url]** to queue a song.')
    mh.logChannel(msgChannel, 'musinf', 'NOW PLAYING: **' + voiceHandler.nowPlaying.title + ' - [' + voiceHandler.nowPlaying.duration + ']** - requested by ' + voiceHandler.nowPlaying.requester)
    return
  }

  // Command: Leave Voice Channel
  if (cmd === 'LEAVE') {
    if (!voiceHandler.voiceConnection) return mh.logChannel(msgChannel, 'err', 'The bot is not in a voice channel!')
    if (voiceHandler.radioMode) {
      voiceHandler.radioMode = false
      mh.logChannel(msgChannel, 'musinf', 'Radio Mode has been toggled to: **OFF**')
    }

    voiceHandler.queue = []
    voiceHandler.dispatcher.end()
    voiceHandler.voiceConnection = undefined
    return
  }

  // Command: Volume Control
  if (cmd === 'VOLUME') {
    if (args.length === 0) return mh.logChannel(msgChannel, 'info', 'Sets the volume of music. Usage: ' + pf + 'volume [1-100]')
    if (args.length === 1 && args[0] <= 100 && args[0] >= 1) {
      voiceHandler.setVolume(args[0])
      mh.logChannel(msgChannel, 'vol', 'Volume set to: ' + args[0])
    } else mh.logChannel(msgChannel, 'err', 'Invalid usage! Usage: ' + pf + 'volume [1-100]')
    return
  }

  if (cmd === 'RADIO') {
    if (args.length === 0) return mh.logChannel(msgChannel, 'info', 'Controls the radio features of the bot. For more info, do: **' + pf + 'radio help**')
    if (args[0].toUpperCase() === 'HELP') return msgChannel.send('__Manual page for: **' + pf + 'radio**__\n**' + pf + 'radio help** - Shows this manual page\n**' + pf + 'radio list** - Displays a list of radio stations\n**' + pf + 'radio set [station]** - Sets the radio to the specified station\n**' + pf + 'radio off** - Deactivates the radio')
    if (args[0].toUpperCase() === 'LIST') return mh.logChannel(msgChannel, 'radioinf', '**Available Radio Stations:** ' + Object.keys(radiolist))
    if (args[0].toUpperCase() === 'SET') {
      if (args.length === 2) {
        if (voiceHandler.voiceConnection) return mh.logChannel(msgChannel, 'err', 'Bot cannot be in a voice channel while activating radio mode. Please disconnect the bot by using ' + pf + 'leave.')
        if (!member.voiceChannel) return mh.logChannel(msgChannel, 'err', 'User is not in a voice channel!')
        if (!radiolist.hasOwnProperty(args[1].toUpperCase())) return mh.logChannel(msgChannel, 'err', 'Invalid station! Use **' + pf + 'radio list** to see a list of all the stations')

        voiceHandler.radioMode = true
        mh.logChannel(msgChannel, 'radioinf', 'NOW PLAYING: Radio Station - **' + args[1] + '**')
        voiceHandler.addPlaylist(radiolist[args[1].toUpperCase()], msg.member)
        .then(() => {
          voiceHandler.voiceConnect(member.voiceChannel)
        })

        return
      }

      return mh.logChannel(msgChannel, 'err', 'Invalid arguments! Usage: **' + pf + 'radio set [station name]**')
    }

    if (args[0].toUpperCase() === 'OFF') {
      if (args.length === 1) {
        voiceHandler.radioMode = false
        mh.logChannel(msgChannel, 'radioinf', 'Ending radio stream.')
        voiceHandler.queue = []
        voiceHandler.dispatcher.end()
        voiceHandler.voiceConnection = undefined
        return
      }

      return mh.logChannel(msgChannel, 'err', 'Invalid arguments! Usage: **' + pf + 'radio off**')
    }
    return mh.logChannel(msgChannel, 'err', 'Invalid usage! For help, use **' + pf + 'radio help.** ')
  }
  return mh.logChannel(msgChannel, 'err', 'Invalid command! For a list of commands, do: **' + pf + 'help**')
})

