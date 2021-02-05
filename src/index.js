const { exec } = require('child_process');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const glob = require('glob');

// console.log = () => {};
// console.debug = () => {};
const tableItems = [];

async function readAllFilesRecursivelly(pattern, cwd) {
  return new Promise((resolve, reject) => {
    glob(pattern, { cwd }, (er, files) => {
      if (er) {
        return reject(er);
      }

      const fullpathFiles = files.map((file) => path.join(cwd, file));

      return resolve(fullpathFiles);
    });
  });
}

const updateProperty = (fileName, section, propName, value) =>
  new Promise((resolve, reject) => {
    const command = `mkvpropedit -v "${fileName}" --edit ${section} --set ${propName}="${value}"`;

    console.debug(`[DEBUG] Running command: ${command}`);

    exec(command, (error, data, getter) => {
      if (error) {
        console.debug(`[DEBUG] Error running command: ${error}`);
        return reject(error);
      }

      // console.debug(`[DEBUG] Command response: ${data}`);

      if (getter) {
        return resolve(data);
      }

      return resolve(data);
    });
  });

const getMeta = (fileName) =>
  new Promise((resolve, reject) => {
    const command = `mkvmerge -J "${fileName}"`;

    // console.debug(`[DEBUG] Running command: ${command}`);

    exec(command, (error, data, getter) => {
      if (error) {
        // console.debug(`[DEBUG] Error running command: ${error}`);
        return reject(error);
      }

      // console.debug(`[DEBUG] Command response: ${data}`);

      if (getter) {
        return resolve(JSON.parse(data));
      }

      return resolve(JSON.parse(data));
    });
  });

/**
 * Updates the title of the video
 *
 * Based on the JSON path container.properties.title
 * Runs mkvpropedit -v <video name> --edit info --set title="<new tile>"
 * @param {*} fileName Path of the video file
 * @param {*} title
 */
async function updateVideoTitle(fileName, title) {
  await updateProperty(fileName, 'info', 'title', title);
}

/**
 * Updates the title of the video stream (or track)
 *
 * Based on the JSON path tracks[where type="video"].properties.title
 * Runs mkvpropedit -v '<video name>' --edit track:<track id> --set name="<new title>"
 * @param {*} fileName Path of the video file
 * @param {*} trackID tracks[where type="video"].properties.number
 * @param {*} title New title
 */
async function updateTrackName(fileName, trackID, title) {
  await updateProperty(fileName, `track:${trackID}`, 'name', title);
}

/**
 *
 * @param {*} fileName
 * @param {*} trackID
 * @param {*} language
 */
async function updateTrackLanguage(fileName, trackID, language) {
  await updateProperty(fileName, `track:${trackID}`, 'language', language);
}

async function updateTrackDefault(fileName, trackID, value) {
  await updateProperty(fileName, `track:${trackID}`, 'flag-default', value);
}

async function validate(meta, fileName, correctName, data) {
  // const { meta } = config;

  /**
   * File properties
   */
  if (data.container.properties.title !== correctName) {
    await updateVideoTitle(fileName, correctName);
  }

  /**
   * Video properties
   */
  const videoTrack = data.tracks.find((x) => x.type === 'video');

  if (videoTrack) {
    if (videoTrack.properties.track_name !== meta.languages[meta.video.language].name) {
      await updateTrackName(
        fileName,
        videoTrack.properties.number,
        // englishTrackName
        meta.languages[meta.video.language].name
      );
    }

    if (videoTrack.properties.language !== meta.video.language) {
      await updateTrackLanguage(
        fileName,
        videoTrack.properties.number,
        // englishLanguageCode
        meta.video.language
      );
    }
  }

  /**
   * Audio properties
   */

  await Promise.all(
    meta.audio.map(async (audio) => {
      const audioTrack = data.tracks.find(
        (x) => x.type === 'audio' && x.properties.language === audio.language
      );

      const promises = [];

      if (audioTrack) {
        if (audioTrack.properties.track_name !== meta.languages[audio.language].name) {
          promises.push(
            updateTrackName(
              fileName,
              audioTrack.properties.number,
              meta.languages[audio.language].name
            )
          );
        }

        if (audioTrack.properties.default_track !== audio.default) {
          promises.push(
            updateTrackDefault(fileName, audioTrack.properties.number, audio.default ? 'yes' : 'no')
          );
        }
      }

      return Promise.all(promises);
    })
  );

  /**
   * Subtitle properties
   */

  await Promise.all(
    meta.subtitles.map(async (subtitle) => {
      const subtitleTrack = data.tracks.find(
        (x) => x.type === 'subtitles' && x.properties.language === subtitle.language
      );

      const promises = [];

      if (subtitleTrack) {
        if (subtitleTrack.properties.track_name !== meta.languages[subtitle.language].name) {
          promises.push(
            await updateTrackName(
              fileName,
              subtitleTrack.properties.number,
              meta.languages[subtitle.language].name
            )
          );
        }

        if (subtitleTrack.properties.default_track !== subtitle.default) {
          promises.push(
            await updateTrackDefault(
              fileName,
              subtitleTrack.properties.number,
              subtitle.default ? 'yes' : 'no'
            )
          );
        }
      }

      return Promise.all(promises);
    })
  );
}

async function lookup(meta, files, episodeIdentifier, episodeName) {
  // lookup(meta, files, episodeIdentifier, episodeName)

  // const episodeIdentifier = `S${seasonNumber.toString().padStart(2, 0)}E${episodeNumber.padStart(2, 0)}`;
  const correctName = `Friends - ${episodeIdentifier} - ${episodeName}`;

  const fileName = files.find((x) => x.includes(episodeIdentifier));

  if (fileName) {
    const json = await getMeta(fileName);

    await validate(meta, fileName, correctName, json);

    if (
      meta.renameFiles &&
      path.basename(fileName, path.extname(fileName)).toUpperCase() !== correctName.toUpperCase()
    ) {
      const pathName = path.dirname(fileName);
      const newFileName = path.join(pathName, `${correctName}${path.extname(fileName)}`);
      await fsPromises.rename(fileName, newFileName);
    }

    const undeterminedTracks = json.tracks.filter((x) => x.type === "audio");

    // if (undeterminedTracks.length > 0) {
    //   tableItems.push(
    //     ...undeterminedTracks.map((x) => ({
    //       name: correctName,
    //       type: x.type,
    //       language: x.properties.language,
    //     }))
    //   );
    // }

    if (undeterminedTracks.length === 0) {
      tableItems.push({
        name: correctName,
        desription: "no audio"
      });
    }
  }

  console.log(`Edits for ${episodeIdentifier} finished`);

  return true;
}

async function parseConfigFile(configFile) {
  const fileContents = await fsPromises.readFile(configFile, { encoding: 'utf-8' });

  const json = JSON.parse(fileContents);

  return json;
}

function verifyDirectoryExists(directory) {
  return new Promise((resolve, reject) => {
    fsPromises
      .access(directory, fs.constants.F_OK || fs.constants.W_OK)
      .then(() => resolve())
      .catch((error) => {
        console.error(`Directory "${directory}" don't exists`);
        reject(error);
      });
  });
}

function getArgv() {
  const { argv } = yargs(hideBin(process.argv))
    .option('directory', {
      alias: 'd',
      type: 'string',
      description: 'Directory to look for files',
      demandOption: 'Please specify a directory to look for files'
    })
    .option('config', {
      alias: 'c',
      type: 'string',
      description: 'Configuration file (JSON)',
      demandOption: 'Please specify a config file'
    })
    .usage('Usage: $0 -d [directory] -c [config file]')
    .demandOption(['d', 'c']);

  return argv;
}

async function main() {
  const argv = getArgv();

  try {
    await verifyDirectoryExists(argv.directory);

    const config = await parseConfigFile(argv.config);

    const files = await readAllFilesRecursivelly('**/*.mkv', argv.directory);

    await Promise.all(
      Object.entries(config.episodes).map(async ([episodeIdentifier, episodeName]) =>
        lookup(config.meta, files, episodeIdentifier, episodeName)
      )
    );

    console.table(tableItems);
  } catch (er) {
    console.error(er);
  }

  console.log('<<<END>>>');
}

main();
