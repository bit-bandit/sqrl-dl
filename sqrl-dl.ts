// --allow-env --allow-read --allow-run --allow-write
// import { assertEquals } from "jsr:@std/assert";
import { delay } from "jsr:@std/async/delay";
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

interface Content {
  id: string;
  timestamp: number;
  view_count: number;
  filesize_approx: number;
  webpage_url: string;
  channel: string;
  // duration: number;
}

// After a period of time downloading, especially in quick
// succession, YouTube's bot detection systems will go into
// effect, and deny access to the pages you want to download.
// Currently, the best method to circumvent this is just giving
// YouTube some time to cool down, and just slowly increase our
// downloading frequency from there.
const Durations = {
  "holdingPeriod": 10 * 60 * 1000, // Wait 10 minutes before downloading anything again.
  // When we first enter the cooldown period, we start with 5 minutes between downloads
  "codeRed": 5 * 60 * 1000,
  // ...then 2.5 minutes
  "codeYellow": 2.5 * 60 * 1000,
  // ...then at 1 minute
  "codeGreen": 60 * 1000,
  // then no intervals between downloads
  "codeClear": 0,
  // How many successful downloads it should take before going down a code.
  "goodDownloadAttempts": 5,
};

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
    "keep-dl-opts", // Keep dl opts specified in channels.txt, ignoring user-provided flags.
    "help", // Print help message
    "version", // Print version info.
    "ignore-cwd",
    "use-cache", // Instead of downloading data of entire channel every time, use local cache.
    "cache", // cache items
    "refresh-cache", // Only refresh cache of channels without downloading them.
  ],
  string: ["index", "home", "output", "priority", "browser-cookies", "sleep"],
  negatable: ["debug", "avatar", "shorts", "videos", "streams", "cache"],
  default: {
    "avatar": true,
    "debug": false,
    "verbose": false,
    "quiet": false,
    "shorts": true,
    "videos": true,
    "streams": true,
    "keep-dl-opts": false,
    "priority": "newest",
    "cache": true,
    "use-cache": false,
    "refresh-cache": false,
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
    "priority": "p",
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
  "  --loglevel <level>,  Set maximum log level. (info by default) ",
  "  -L <level>           Valid values: catastrophic, error, warning,",
  "                           info, verbose, pedantic, nittygritty, debug.",
  "                       Setting the level to `pedantic' or further will",
  "                       enable log level prefixes on log entries.",
  "  -p, --priority <opt> Set prefered priority on which to download content.",
  "                       Valid values: popular, unpopular, oldest, newest,",
  "                           max-filesize, min-filesize, max-duration,",
  "                           min-duration. (newest by default)",
  "  --debug              Log debug information. Alias of `--loglevel debug'.",
  "  --verbose            Log verbose output. Alias of `--loglevel verbose'.",
  "  -q, --quiet          Log nothing. Alias of `--loglevel quiet'.",
  "  -i, --index          One digit (i.e, 3), or two digits seperated ",
  "                       by a hyphen (i.e, 3-7) corrosponding to lines ",
  "                       in channels.txt, which will be downloaded within ",
  "                       the provided range. ",
  "  --cache              Cache channel data in local files.",
  "  --use-cache          Use local cache for channel data instead of",
  "                       downloading it again.",
  "  --refresh-cache      Only refresh channel caches this session.",
  "  --browser-cookies    Obtain cookies from specified browser.",
  "  --sleep <seconds>    Delay in between requests.",
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
const safeURL = (url: string): string => `https://www.youtube.com/${url}`;

/**
 * Get an array containing the IDs of the videos we've downloaded already.
 */
const getArchivedContents = async (): Promise<string[]> =>
  await Deno.readTextFile(Files.archive).then((x) => x.split("\n")).then((x) =>
    x.map((y) => y.split(" ")[1])
  ).then((x) => x.filter((y) => y !== undefined));

/**
 * Get the URL containing a channels RSS feed.
 */
const channelRSSFeedURL = async (channel: string): Promise<string> =>
  await $`yt-dlp --print "channel_id" --playlist-items 1 ${channel}`.text()
    .then((x) => `https://www.youtube.com/feeds/videos.xml?channel_id=${x}`);

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

const arrangePriority = (list: Content[]): Content[] => {
  const arrangeNewest = (a: Content, b: Content) => b.timestamp - a.timestamp;
  const arrangePopular = (a: Content, b: Content) =>
    b["view_count"] - a["view_count"];
  const arrangeFilesize = (a: Content, b: Content) =>
    b["filesize_approx"] - a["filesize_approx"];
  // const arrangeduration = (a: Content, b: Content) =>
  //   b["duration"] - a["duration"];

  switch (Args.priority) {
    case "newest": {
      return list.sort(arrangeNewest);
    }
    case "oldest": {
      return list.sort(arrangeNewest).reverse();
    }
    case "popular": {
      return list.sort(arrangePopular);
    }
    case "unpopular": {
      return list.sort(arrangePopular).reverse();
    }
    case "max-filesize": {
      return list.sort(arrangeFilesize);
    }
    case "min-filesize": {
      return list.sort(arrangeFilesize).reverse();
    }
    // case "max-duration": {
    //   return list.sort(arrangeduration);
    // }
    // case "min-duration": {
    //   return list.sort(arrangeduration).reverse();
    // }

    default: {
      logMessage(
        log.error,
        `Not sure what you meant by ${Args.priority}. Defaulting to newest...`,
      );
      return list.sort(arrangeNewest);
    }
  }
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

/**
 * Append detected new channels to `channels.txt`.
 * @param {Channel[]} channels Array of new channels.
 */
const addChannels = async (channels: Channel[]): Promise<void> => {
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

  if (browsers.includes(Args["browser-cookies"] as string)) {
    logMessage(
      log.pedantic,
      `Adding browser cookies: ${Args["browser-cookies"]}`,
    );
    return `--cookies-from-browser=${Args["browser-cookies"]}`;
  }

  for (const browser of browsers) {
    try {
      await $`${browser} --version`.quiet();
      logMessage(log.pedantic, `Adding browser cookies: ${browser}`);
	str = `--cookies-from-browser=${browser}`;
	break;
    } catch {
      continue;
    }
  }
  return str;
};

/**
 * Parses the raw `channels.txt` file and spits out the channels it has.
 * @param {string} rawFile relevent `channels.txt` file.
 * @returns {Channel[]} Array of channels.
 */
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
 * Gets Content we want to download.
 * @param {string} channel Endpoint we're going to parse.
 */
const getContent = async (channel: string): Promise<Content[]> => {
  const arr: Content[] = [];
  let i = 1;
  logMessage(log.info, `Downloading cache for ${channel}`);

  let additional = "";

  if (Args.sleep) {
    additional += `--sleep-requests=${Args.sleep}`;
  }

  const cookies = await getCookies();

  try {
    const cmd =
      $`yt-dlp ${channel} ${cookies} ${additional} --print "%(.{id,timestamp,view_count,filesize_approx,webpage_url,channel})#j" -R "infinite" --file-access-retries "infinite" --extractor-retries "infinite"`
        .stdout("piped").spawn();

    for await (const chunk of cmd.stdout()) {
      try {
        const item = JSON.parse(new TextDecoder().decode(chunk));
        arr.push(item);
        logMessage(
          log.info,
          `Retrived item ${i.toString().padStart(4, "0")}: ${item.id} (${
            new Date(item.timestamp * 1000).toISOString()
          })`,
        );
        i++;
      } catch (e) {
        console.log(e);
        continue;
      }
    }
  } catch {
    return arr;
  }
  return arr;
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

  command += await getCookies();

  try {
    await $.raw`${command}`;
  } catch (e) {
    logMessage(log.error, e);
  }
};

const followRules = async (url: string, opts: DownloadOpts): Promise<void> => {
    // const rules = await Deno.readTextFile("./channel/rules.json").then(x => JSON.parse(x))
    const rules = {}
    if (rules.contentEndpoints) {
	content 
    } 
}

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

    try {
      await Deno.stat(`./cache`);
    } catch {
      await Deno.mkdir(`./cache`);
    }

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
      logMessage(log.debug, `chdir ${Files.output}/${name}`);
      Deno.chdir(`${Files.output}/${name}`);
      // FIXME: Replace `any`s here with something actually useful.
      if ((opts as any)[category] || (channel.args! as any)[category]) {
        logMessage(log.info, `Downloading ${category}...`);

        logMessage(log.debug, `stat ./${category}`);
        try {
          logMessage(log.debug, `Checking for ./${category} in ${Deno.cwd()}`);
          await Deno.stat(`./${category}`);
        } catch {
          logMessage(log.debug, `Creating ./${category} in ${Deno.cwd()}`);
          await Deno.mkdir(`./${category}`);
        }

        logMessage(log.debug, `chdir ./${category}`);
        Deno.chdir(`./${category}`);

        logMessage(
          log.pedantic,
          `Trying to retrive info about contents of ${(channel as any)[
            category
          ]!}`,
        );

        let contents: Content[];
        let noLocalCache = false;

        if (Args["use-cache"]) {
          logMessage(
            log.pedantic,
            `Using local ${category} cache for channel ${name}`,
          );
          try {
            contents = await Deno.readTextFile(`../cache/${category}.json`)
              .then((x) => JSON.parse(x));
          } catch {
            logMessage(
              log.error,
              `Can't find cache for ${category} for channel ${name}. Downloading now...`,
            );
            noLocalCache = true;
            contents = await getContent((channel as any)[category]!);
            continue;
          }
        } else {
          logMessage(
            log.pedantic,
            `Creating ${category} cache for channel ${name}`,
          );
          try {
            contents = await getContent((channel as any)[category]!);
          } catch {
            continue;
          }
        }

        logMessage(log.pedantic, `Retrival of ${channel.base} successful`);

        if (!Args["use-cache"] || noLocalCache) {
          try {
            // log("Writing cache of {category} for {channel}")
            await Deno.writeTextFile(
              `../cache/${category}.json`,
              JSON.stringify(contents),
            );
          } catch {
            // log("Writing cache of {category} for {channel}")
          }
        }

        if (Args["refresh-cache"]) {
          continue;
        }

        logMessage(log.pedantic, `Contents: ${JSON.stringify(contents)}`);
        contents = arrangePriority(contents);
        const archived = await getArchivedContents();
        const filtered = contents.filter((x) => !archived.includes(x.id));
        logMessage(
          log.info,
          `Removed ${
            contents.length - filtered.length
          } items already downloaded.`,
        );
        contents = filtered;

        logMessage(
          log.pedantic,
          `Sorted Contents: ${JSON.stringify(contents)}`,
        );

        for (let i = 0; i < contents.length; i++) {
          logMessage(
            log.info,
            `Downloading video ${i + 1}/${contents.length + 1}`,
          );
          try {
            await downloadContent(contents[i]["webpage_url"]);
            logMessage(log.info, `Download successful...`);
          } catch (e) {
            logMessage(log.error, e);
          }
        }

        if (Args.sleep) {
          await delay(parseInt(Args.sleep) * 1000);
        }
      }
    }
  }
};

/** Where the magic happens */
const main = async (): Promise<void> => {
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

  if (Args._.length > 0) {
    const downloadUs = parseChannels(Args._.join("\n"));
    await addChannels(downloadUs);
  }

  if (Args._.length == 0) {
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
  }

  let channels = parseChannels(raw_file);

  if (Args._.length > 0) {
    const downloadUs = parseChannels(Args._.join("\n"));
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
