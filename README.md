# Video Salad Core

Multimedia muxer, demuxer, encoder. Work with multiple files and produce as many file combinations needed.

Video Salad Core provides a simple interface to mux any multimedia file and is largely intended for muxing multiple files.
While Video Salad Core is primarily the meat of the desktop graphical interface Video Salad, it is usable as a standalone application. Add and create any number of files, edit properties and media for created files.
Video Salad Core internally uses FFmpeg and therefore requires an installation of FFmpeg. See Setup for details.

> Video Salad Core is very new and fresh. In fact, so fresh there ~~may~~ will be bugs and issues in untested use cases.


# Features

* Mux to any media container or file
* Add/Remove/Edit metadata such as title, author, etc.
* Add/Remove dispositions such as default, forced, etc.
* Add/Remove/~~Edit~~ chapters (Editing in future feature)
* Add media losslessly from any source to any desired container(s) or file(s)
* Remove unwanted media
* Convert media to a different codec with parameters (Needs more codecs support)
* ~~Delay individual media~~ (Future feature)
* Add custom FFmpeg options to each individual media (Requires testing)
* Batch process multiple files simultaneously

## Possible Future Features

* Parse subtitles to determine what fonts are necessary
* Add non-FFmpeg libraries to get more data on Ingredients
* Support Streams


# Examples

## Simple Use Cases

* Add or edit a Title metadata tag on a media track and/or video file
* Merge multiple files or media into one file
* Remove audio and subtitle tracks of certain language(s)
* Set language metadata on any video, audio, or subtitle tracks
* Convert audio tracks to OPUS (More codecs support planned)

## Advanced Use Cases (Based on Intended Usage)

__These use cases are intended to be automated with the Video Salad Desktop Application__

### Muxing:

* Find all individual media with the same file name (without extension)
    * Combine into a single Matroska (MKV) file
    * Add title metadata tag
    * Remove all subtitles except Klingon (`tlh`)
    * Convert non-OPUS audio files to OPUS
        * Set bitrate to 192000 for stereo (2ch) or 320000 for 5.1

### Demuxing:

* For each media container file
    * For each video, audio, subtitle track
        * Separate into respective .mkv, .mka, and .mks files
        * Add fonts (attachment media) to every .mks file in respective container
        * Add chapters to .mkv files only
    * Copy audio tracks
        * Convert to OPUS and add to new respective .mka file
        * Add -OPUS to end of file name before extension

# Setup

> More details will be added when Video Salad Core is ready for being published to NPM. For now, this project has been only locally tested and installed via `npm install ../relative/path/to/video-salad-core` and `npm link`. This repository is being initialized for improving that installation without publicly publishing otherwise untested or unstable code.

## FFmpeg

### Installing FFmpeg

### Adding FFmpeg to PATH (Optional)

## Installing

### From NPM

```console
$ npm install --save video-salad-core
```

### From Local Repository

```console
$ npm install --save ../path/to/video-salad-core
```

Or with `npm link`

```console
$ npm link ../path/to/video-salad-core

$ cd to/my/project

$ npm link video-salad-core
```

## Initializing

Video Salad Core can be initialized without any parameters. If so and if FFmpeg is installed and specified in the PATH, Video Salad Core will attempt to use it.
Otherwise, it can be specified for each executable.

* `ffmpegPath`: string - Full path to FFmpeg executable file
* `ffprobePath`: string - Full path to FFProbe executable file

```typescript
import { VideoSalad } from 'video-salad-core';

// Get custom FFmpeg and FFProbe executable file paths

const videoSalad = new VideoSalad(ffmpegPath, ffProbePath);
```
Now we're cooking!

# Using Video Salad Core


## Adding Ingredient Bowls

Importing media files and containers given a file path

```typescript
import { VideoSalad } from 'video-salad-core';

const videoSalad = new VideoSalad();

```

## Creating Mixing Bowls



## Adding Ingredients to Mixing Bowls



## Removing Ingredients from Mixing Bowls



## Copying Ingredients



## Removing Copied Ingredients from Ingredient Bowls



## Modifying Ingredients



### Modifying Tags



### Adding/Removing Dispositions



### 


# Video Salad Core Components Reference

This section has ~~unintentionally~~ been left blank.

## Bowls



### Ingredient Bowls



### Mixing Bowls



## Ingredients

### Chapters Ingredient



### Stream Ingredients



#### Video Stream Ingredients



#### Audio Stream Ingredients



#### Subtitle Stream Ingredients



#### Attachment Stream Ingredients


#### Data Stream Ingredients


# Nutty Nomenclature

What's the deal with the wacky words and ~~terrible~~ terrific terminology?

## Salad

MKV files - and similar multimedia containers - are composed of multiple distinct and separable media files or streams/tracks. In a similar sense, a typical salad is composed of multiple distinct and technically separable ingredients. With video containers and salads both being heterogeneous, an obsession arose to equate ingredients with video, audio, subtitle, and attachment media tracks. The underlying abstractions were named after their salad counterparts and **if any significant naming issues or confusion arise during development, they will be removed** despite our eagerness to use culinary categorization.

## Bowls

### Ingredient Bowl

### Mixing Bowl

## Ingredients

### Stream Ingredient

### Chapters Ingredient



# Contributing



## Development Setup



## Build Production



# Special Thanks

Without these projects Video Salad Core and subsequently Video Salad would not be here today. We'd like to give big props to these organizations:

* **FFmpeg**: This software uses code of <a href=http://ffmpeg.org>FFmpeg</a> licensed under the <a href=http://www.gnu.org/licenses/old-licenses/lgpl-2.1.html>LGPLv2.1</a> and its source can be downloaded <a href=link_to_your_sources>here</a>"
* **Fluent-ffmpeg**: <a href="https://github.com/fluent-ffmpeg/node-fluent-ffmpeg">Contributers at Fluent-ffmpeg</a>

# Current Issues and Planned Features

* Fix +disposition not working
* Reimplement ESM packages like `iso-639-2` by using rollup or similar to package for CJS
* Update stream copy/duplicate for refactored ingredient conversion
* Opus conversion may have issues with 5.1 or higher
    * Consider adding `-mapping_family` in place of modifying channels
    * Add this to `AudioConversionOptions`
* Add better support for custom filters for ffmpeg (add function to StreamIngredient)
* Limit Ingredient ConversionOptionsSchema based on FFmpeg capabilities
* Custom errors for Bowl `Mix`, Ingredient `BuildOptions`, and Ingredient `Convert`
* Add options to NutritionLogger from VideoSalad instantiation
* Add typedoc & generation
* T-Tests?!


# Current Limitations

* Despite underlying support, Bowls can only be created by a file path and not a stream.
* Chapters are not modifiable from the commandline in FFmpeg without piping in a text file to set the chapters wholesale.
    * Research and testing required to attempt this without writing files to disk.
