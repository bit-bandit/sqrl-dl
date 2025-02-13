// --allow-env --allow-read --allow-run --allow-write
// import { assertEquals } from "jsr:@std/assert";
import { parseArgs } from "jsr:@std/cli/parse-args";

import $ from "jsr:@david/dax";

import { log, logMessage, logSettings } from "./log.ts";

interface ChannelSettings {
  [key: string]: [string, boolean];
}

interface DownloadOpts {
  avatar: boolean;
  videos: boolean;
  shorts: boolean;
  streams: boolean;
}

interface Channel {
  base?: string;
  streams?: string;
  shorts?: string;
  videos?: string;
  args?: DownloadOpts;
}

const Version = "0.5.0";

// Core files we'll be refering to throughout this script.
const Files = {
  "base": `${Deno.env.get("HOME")}/Videos/YouTube/`, // I am NOT ironing this out untill later.
  "output": `${Deno.env.get("HOME")}/Videos/YouTube/`,
  "channels": `${Deno.env.get("HOME")}/Videos/YouTube/channels.txt`,
  "archive": `${Deno.env.get("HOME")}/Videos/YouTube/archive.txt`,
};

// Core arguments provided by the user.
const Args = parseArgs(Deno.args, {
  boolean: [
    "debug",
    "verbose",
    "quiet",
    "avatar", // Download avatar this session.
    "shorts", // Download shorts this session.
    "videos", // Download videos this session.
    "streams", // Download streams this session.
    "oldest-first", // Sort channels by oldest video first.
    "keep-dl-opts", // Keep dl opts specified in channels.txt, ignoring user-provided flags.
    "help", // Print help message
    "version", // Print version info.
    "ignore-cwd", //
  ],
  string: ["index", "home", "output"],
  negatable: ["debug", "avatar", "shorts", "videos", "streams"],
  default: {
    "avatar": true,
    "debug": false,
    "verbose": false,
    "quiet": false,
    "shorts": true,
    "videos": true,
    "streams": true,
    "oldest-first": false,
    "keep-dl-opts": false,
  },
  alias: {
    "avatar": "a",
    "shorts": "s",
    "videos": "v",
    "streams": "l",
    "index": "i",
    "keep-dl-opts": "k",
    "help": "h",
    "version": "v",
    "loglevel": "L",
    "quiet": "q",
    "home": "H",
    "output": "O",
  },
});

// Help text when provided with --help (or -h) in the flags.
// Largely, you can get away with just copy-pasting what's been
// included in the args comment, keeping the comments as the notes
// for the program itself.
// When including a newline, please make sure that it's preceeded by a
// space. This is just for ensuring that reading the raw strings
// below aren't a total pain (hopefully.)
const HelpText = [
  "Usage: sqrl-dl [OPTION]... [CHANNEL]... ",
  "Download YouTube channels. ",
  "",
  "With no CHANNEL(s), sqrl-dl will read from ~/Videos/YouTube/channels.txt, ",
  "or from the file named channels.txt in the current working directory. ",
  "",
  "  -a, --avatar         Download avatar this session. (true by default) ",
  "  --no-avatar          Don't download avatar this session. ",
  "  -v, --videos         Download videos this session. (true by default) ",
  "  --no-videos          Don't download videos this session. ",
  "  -l, --streams        Download streams this session. (true by default) ",
  "  --no-streams         Don't download streams this session. ",
  "  -s, --shorts         Download shorts this session. (true by default) ",
  "  --no-shorts          Don't download shorts this session. ",
  "  --oldest-first       Download older videos first (true by default) ",
  "  --loglevel <level>,  Set maximum log level. (info by default) ",
  "  -L <level>           Valid values: catastrophic, error, warning,",
  "                           info, verbose, pedantic, nittygritty, debug.",
  "                       Setting the level to `pedantic' or further will",
  "                       enable log level prefixes on log entries.",
  "  --debug              Log debug information. Alias of `--loglevel debug'.",
  "  --verbose            Log verbose output. Alias of `--loglevel verbose'.",
  "  -q, --quiet          Log nothing. Alias of `--loglevel quiet'.",
  "  -i, --index          One digit (i.e, 3), or two digits seperated ",
  "                       by a hyphen (i.e, 3-7) corrosponding to lines ",
  "                       in channels.txt, which will be downloaded within ",
  "                       the provided range. ",
  "  -H, --home           Folder to find and place files, like channels.txt",
  "  -O, --output         Folder for downloaded channels (same as home by default)",
  "  -h, --help           See this message and exit. ",
  "  -v, --version        output version information and exit ",
  "",
  "For further inquries:  https://github.com/bit-bandit/sqrl-dl",
].join("\n");

// Not really an accurate term, but whatever.
/**
 * Prepends YouTube URL to end of channel ID.
 * @param {string} url URL to convert.
 * @returns {string}
 */
const safeURL = (url: string): string => {
  return `https://www.youtube.com/${url}`;
};

/** Does nessicary checks/preperations for the local environment. */
const prepareEnv = async (): Promise<void> => {
  logMessage(log.debug, "Checking for working yt-dlp ..");
  try {
    await $`yt-dlp --version`.quiet();
  } catch {
    logMessage(log.error, "yt-dlp isn't downloaded.");
    Deno.exit(1);
  }
  logMessage(log.debug, `Check for directory ${Files.base} ..`);
  try {
    await Deno.stat(Files.base);
  } catch {
    await Deno.mkdir(Files.base);
  }
  logMessage(log.debug, "Environment passes checks");
};

/**
 * Parses arguments provided in `channels.txt` and returns a `DownloadOpts` object.
 * @param {string} rawargs Original arguments as shown in `channels.txt` (i.e, "a,l,s,v")
 */
const parseChannelDownloadOpts = (rawArgs: string): DownloadOpts => {
  const usrArgs = rawArgs.split(",");

  const channelArgs = {
    avatar: Args.avatar,
    videos: Args.videos,
    shorts: Args.shorts,
    streams: Args.streams,
  };

  if (!Args["keep-dl-opts"]) {
    return channelArgs as DownloadOpts;
  }

  // "setting-name": [argValueToEffect, desiredBoolean]
  const settings: ChannelSettings = {
    "A": ["avatar", false],
    "a": ["avatar", true],
    "L": ["streams", false],
    "l": ["streams", true],
    "S": ["shorts", false],
    "s": ["shorts", true],
    "V": ["videos", false],
    "v": ["videos", true],
  };

  for (const setting in settings) {
    if (usrArgs.includes(setting)) {
      // FIXME: Replace `any` type with something genuinely useful.
      (channelArgs as any)[settings[setting][0]] = settings[setting][1];
    }
  }
  return channelArgs as DownloadOpts;
};

const addChannels = async (channels: Channel[]) => {
  logMessage(log.pedantic, "Adding channels");

  await Deno.readTextFile(Files.channels).then(async (f) => {
    logMessage(log.debug, "Successfully read channels.txt");

    const actualChannels: string[] = [];
    f.split("\n")
      .filter((x) => x !== "")
      .forEach((x) => actualChannels.push(x.split(" ")[0]));

    for (const channel of channels) {
      if (!actualChannels.includes(channel.base!)) {
        f += `${channel.base}\n`;
      }
    }
    try {
      logMessage(log.debug, "Trying to write channels.txt ..");
      await Deno.writeTextFile(Files.channels, f);
    } catch (e) {
      logMessage(log.error, e);
      await Deno.exit(1);
    }
  });
};

/** Get browser cookies automatically. */
const getCookies = async (): Promise<string> => {
  const browsers = ["firefox", "chromium", "chrome"];
  let str = "";
  for (const browser of browsers) {
    try {
      await $`${browser} --version`.quiet();
      logMessage(log.pedantic, `Adding browser cookies: ${browser}`);
      str += `--cookies-from-browser ${browser} `;
    } catch {
      continue;
    }
  }
  return str;
};

/** Parses the raw `channels.txt` file and spits out the channels we need. */
const parseChannels = (rawFile: string): Channel[] => {
  logMessage(log.pedantic, `Parsing channels..`);

  const channels = rawFile.split("\n")
    .filter((x) => x != "");

  const parsedChannels: Channel[] = [];

  for (let i = 0; i < channels.length; i++) {
    const channelObj: Channel = {};
    const channel = channels[i].split(" ");

    logMessage(log.pedantic, `Parsing for channel ${i}`);

    if (channel[0].startsWith("@")) {
      channelObj.base = safeURL(channel[0]);
    } else if (channel[0].endsWith("/")) {
      channelObj.base = channel[0].slice(0, -1);
    } else {
      channelObj.base = channel[0];
    }

    channelObj.streams = channelObj.base + "/streams";
    channelObj.shorts = channelObj.base + "/shorts";
    channelObj.videos = channelObj.base + "/videos";

    if (channel.length > 1) {
      channelObj.args = parseChannelDownloadOpts(channel[1]);
    } else {
      channelObj.args = {
        "avatar": Args.avatar,
        "shorts": Args.shorts,
        "streams": Args.streams,
        "videos": Args.videos,
      };
    }

    logMessage(log.pedantic, `Channel ${i} done.`);

    parsedChannels[i] = channelObj;
  }

  logMessage(log.pedantic, `Done parsing channels.`);

  return parsedChannels;
};

/**
 * Download the avatar of a given channel. Currently relies on a semi-obscure
 * feature on the implimentation side of things.
 * @param {string} channel base URL of the channel. (i.e, "https://www.youtube.com/@jawed")
 */
const downloadAvatar = async (channel: string): Promise<void> => {
  await $`yt-dlp ${channel} --write-thumbnail --playlist-items 0 --output="avatar/avatar-%(uploader)s-%(epoch)s.(ext)s"`;
  await $`yt-dlp ${channel} --write-thumbnail --playlist-items 0 --output="cover.(ext)s"`;
};

/**
 * Downloads all content from a specified endpoint.
 * @param {string} url String containing the URL.
 */
const downloadContent = async (url: string): Promise<void> => {
  let command =
    `yt-dlp ${url} -f "bestvideo+bestaudio/best" --embed-thumbnail ` +
    "--continue " +
    "--embed-metadata " +
    `--download-archive ${Files.archive} ` +
    `-o "./%(upload_date)s %(title).50s - %(id)s.%(ext)s" ` +
    "--restrict-filenames ";

  if (Args["oldest-first"]) {
    command += "--playlist-reverse ";
  }

  command += await getCookies();

  try {
    await $.raw`${command}`;
  } catch (e) {
    logMessage(log.error, e);
  }
};

/**
 * Downloads each marked channel at each endpoint present in its object.
 */
const downloadChannels = async (
  channels: Channel[],
  opts: DownloadOpts,
): Promise<void> => {
  logMessage(log.verbose, `Downloading channels..`);

  for (const channel of channels) {
    logMessage(log.debug, `chdir ${Files.base}`);
    Deno.chdir(Files.base);

    logMessage(
      log.pedantic,
      `Running yt-dlp command to download channel name..`,
    );
    const command =
      `yt-dlp -I1 --flat-playlist --print playlist_channel ${channel.videos}`;
    const name = await $.raw`${command}`.text();

    logMessage(log.info, `-- Downloading channel @${name}..`);

    logMessage(log.debug, `stat ./${name}`);
    try {
      await Deno.stat(`${name}`);
    } catch {
      await Deno.mkdir(`${name}`);
    }

    logMessage(log.debug, `chdir ./${name}`);
    Deno.chdir(`./${name}`);

    if (opts.avatar) {
      logMessage(log.verbose, "Downloading channel avatar..");
      await downloadAvatar(channel.base!);

      logMessage(log.pedantic, "De-duplicating channel avatars..");
      // Deduplicates already-existing avatars.
      const uniq: string[] = [];
      for await (const pict of Deno.readDir("./avatar")) {
        if (!pict.isFile) {
          continue;
        }
        const sum = await $`sha256sum ./avatar/${pict.name}`.text().then(
          (s) => s.split("  "),
        );
        if (!uniq.includes(sum[0])) {
          uniq.push(sum[0]);
        } else {
          logMessage(log.pedantic, `Removing duplicate avatar ${sum[1]}..`);
          await Deno.remove(sum[1]);
        }
      }
    }

    const categories = ["videos", "shorts", "streams"];

    for (const category of categories) {
      // FIXME: Replace `any`s here with something actually useful.
      if ((opts as any)[category] || (channel.args! as any)[category]) {
        logMessage(log.info, `Downloading ${category}...`);

        logMessage(log.debug, `stat ./${category}`);
        try {
          await Deno.stat(`./${category}`);
        } catch {
          await Deno.mkdir(`./${category}`);
        }

        logMessage(log.debug, `chdir ./${category}`);
        Deno.chdir(`./${category}`);

        try {
          await downloadContent((channel as any)[category]!);
        } catch (e) {
          logMessage(log.error, e);
        }

        logMessage(log.debug, "chdir ../");
        Deno.chdir("../");
      }
    }
  }
};

/** Where the magic happens */
const main = async () => {
  const downloadOpts: DownloadOpts = {
    "avatar": Args.avatar,
    "videos": Args.videos,
    "shorts": Args.shorts,
    "streams": Args.streams,
  };

  if (Args.verbose) {
    logSettings.logLevel = log.verbose;
    logSettings.prefix = false;
  }

  if (Args.debug) {
    logSettings.logLevel = log.debug;
    logSettings.prefix = true;
  }

  if (Args.quiet) {
    logSettings.logLevel = log.quiet;
    logSettings.prefix = false;
  }

  if (Args.loglevel) {
    const setLogLevel = log[Args.loglevel as string];
    if (setLogLevel != null) {
      logSettings.logLevel = setLogLevel;
      logSettings.prefix = setLogLevel >= log.pedantic;
    }
  }

  logMessage(log.debug, "Arguments:", JSON.stringify(Args));

  if (Args.help) {
    logMessage(log.info, HelpText);
    Deno.exit(0);
  }

  if (Args.version) {
    logMessage(log.info, Version);
    Deno.exit(0);
  }

  await prepareEnv();

  let raw_file = "";

  let home_folder = Deno.cwd();

  if (Args.home) {
    home_folder = Args.home;
  }

  // Check if there's a file + archive in the cwd and use that
  // for the main file if detected.
  try {
    Deno.stat(`${home_folder}/channels.txt`);
    Deno.stat(`${home_folder}/archive.txt`);

    logMessage(
      log.debug,
      `Using archive, and channel files found in: ${Deno.cwd()}`,
    );

    Files.base = home_folder;
    Files.output = home_folder; // changed later when we check for the arg specifically
    Files.channels = `${home_folder}/channels.txt`;
    Files.archive = `${home_folder}/archive.txt`;
  } catch {
    if (Args.debug) {
      logMessage(
        log.debug,
        `No archive/channel file(s) found in: ${Deno.cwd()}`,
      );
    }

    if (Args.home) {
      console.error(`Home folder ${home_folder} has no archive/channel file`);
      Deno.exit(1);
    }
  }

  if (Args.output) {
    try {
      let fileInfo = await Deno.stat(Args.output);

      if (!fileInfo.isDirectory) {
        throw new Error();
      }

      await Deno.writeTextFile("fhqwhgads.tmp", "");
      await Deno.remove("fhqwhgads.tmp");
    } catch {
      console.error(
        "Path given either doesn't exist, isn't a directory, is unreadable, or is unwritable",
      );
      Deno.exit(1);
    }

    Files.output = Args.output;
  }

  try {
    raw_file = await Deno.readTextFile(Files.channels);
    if (raw_file.length === 0) {
      logMessage(log.error, "Channel file empty.");
      Deno.exit(1);
    }
  } catch {
    logMessage(log.error, "No channel file found.");
    Deno.exit(1);
  }

  let channels = parseChannels(raw_file);

  if (Args._.length > 0) {
    const downloadUs = parseChannels(Args._.join("\n"));
    await addChannels(downloadUs);
    await downloadChannels(downloadUs, downloadOpts);
    await Deno.exit(0);
  }

  if (Args.index) {
    const indexes = Args.index.split("-");
    if (indexes.length === 1) {
      try {
        channels = channels.slice(parseInt(indexes[0]));
      } catch {
        logMessage(log.error, "Indexes out of range.");
      }
    } else if (indexes.length > 1) {
      try {
        channels = channels.slice(parseInt(indexes[0]), parseInt(indexes[1]));
      } catch {
        logMessage(log.error, "Indexes out of range.");
      }
    }
  }

  await downloadChannels(channels, downloadOpts);
};

await main();
