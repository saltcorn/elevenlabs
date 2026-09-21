const Workflow = require("@saltcorn/data/models/workflow");
const Form = require("@saltcorn/data/models/form");
const File = require("@saltcorn/data/models/file");
const User = require("@saltcorn/data/models/user");
const View = require("@saltcorn/data/models/view");
const Trigger = require("@saltcorn/data/models/trigger");
const FieldRepeat = require("@saltcorn/data/models/fieldrepeat");
const Plugin = require("@saltcorn/data/models/plugin");
const { domReady } = require("@saltcorn/markup/tags");
const db = require("@saltcorn/data/db");
const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");
const { getState } = require("@saltcorn/data/db/state");
const  { createWriteStream } = require("fs");
const  { pipeline } = require("stream/promises");
const  { Readable } = require("stream");
const configuration_workflow = () =>
  new Workflow({
    steps: [
      {
        name: "API key",
        form: async (context) => {
          return new Form({
            fields: [
              {
                name: "api_key",
                label: "API key",
                sublabel: "ElevenLabs API key",
                type: "String",
                required: true,
                fieldview: "password",
              },
            ],
          });
        },
      },
    ],
  });

const functions = (config) => {
  return {
    elevenlabs_get_client: {
      run: (opts) => {
        return new ElevenLabsClient({
          apiKey: opts?.api_key || config.api_key,
        });
      },
      isAsync: false,
      description: "Get the elevenlabs client",
      arguments: [
        {
          name: "api_key",
          type: "String",
        },
      ],
    },
    elevenlabs_transcribe: {
      run: async (opts) => {
        return await new ElevenLabsClient({
          apiKey: opts?.api_key || config.api_key,
        }).speechToText.convert({
          file: await (await File.findOne(opts.file)).get_contents(),
          modelId: opts.model || "scribe_v2", // Model to use
          tagAudioEvents: true, // Tag audio events like laughter, applause, etc.
          languageCode: opts.languageCode || "eng", // Language of the audio file. If set to null, the model will detect the language automatically.
          numSpeakers: opts.numSpeakers || null, // Language of the audio file. If set to null, the model will detect the language automatically.
          diarize: !!opts.diarize, // Whether to annotate who is speaking
          diarizationThreshold: opts.diarizationThreshold || null,
        });
      },
      isAsync: true,
      description: "Transcribe audio with 11labs",
      arguments: [
        {
          name: "options",
          type: "JSON",
          tstype:
            "{file: string, api_key?: string, diarize?: boolean, model?: string, languageCode?: string}",
          required: true,
        },
      ],
    },
    elevenlabs_text_to_speech: {
      run: async (opts) => {
        const filePath = File.get_new_path(opts.fileName, true);

        // Accept either camelCase (API-native) or snake_case (as used by
        // existing scripts) keys and map them onto the request's
        // voiceSettings, which the ElevenLabs SDK requires in camelCase.
        const rawSettings = opts.voiceSettings || opts.voice_settings;
        let voiceSettings;
        if (rawSettings) {
          voiceSettings = {};
          const stability = rawSettings.stability;
          const similarityBoost =
            rawSettings.similarityBoost ?? rawSettings.similarity_boost;
          const style = rawSettings.style;
          const useSpeakerBoost =
            rawSettings.useSpeakerBoost ?? rawSettings.use_speaker_boost;
          const speed = rawSettings.speed;
          if (stability !== undefined) voiceSettings.stability = stability;
          if (similarityBoost !== undefined)
            voiceSettings.similarityBoost = similarityBoost;
          if (style !== undefined) voiceSettings.style = style;
          if (useSpeakerBoost !== undefined)
            voiceSettings.useSpeakerBoost = useSpeakerBoost;
          if (speed !== undefined) voiceSettings.speed = speed;
        }

        const audio = await new ElevenLabsClient({
          apiKey: opts?.api_key || config.api_key,
        }).textToSpeech.convert(opts.voiceId, {
          text: opts.text,
          modelId: opts.model || "eleven_multilingual_v2", // good all-round quality model
          languageCode: opts.languageCode || undefined, // Language of the audio file. If set to null, the model will detect the language automatically.
          outputFormat: "mp3_44100_128", // 44.1 kHz, 128 kbps MP3
          ...(voiceSettings ? { voiceSettings } : {}),
        });

        // The stream may be a web ReadableStream depending on the runtime;
        // normalize it to a Node stream, then pipe it to the output file.
        const nodeStream =
          typeof audio.getReader === "function"
            ? Readable.fromWeb(audio)
            : audio;

        await pipeline(nodeStream, createWriteStream(filePath));
        const relPath = File.absPathToServePath(filePath);
        return await File.findOne(relPath);
      },
      isAsync: true,
      description: "Text-to-speech with 11labs",
      arguments: [
        {
          name: "options",
          type: "JSON",
          tstype:
            "{fileName: string, voiceId: string, text: string, api_key?: string, model?: string, languageCode?: string, voice_settings?: {stability?: number, similarity_boost?: number, style?: number, use_speaker_boost?: boolean, speed?: number}}",
          required: true,
        },
      ],
    },
  };
};

const routes = (config) => {
  return [
    {
      url: "/elevenlabs/toolcall",
      method: "post",
      noCsrf: true,
      callback: async (req, res) => {
        //console.log("11labs toolcall", req.query, req.body)
        const { viewname, toolname, secret, ...rest } = req.query;
        const view = View.findOne({ name: viewname });
        if (!view) {
          res.status(400).send("View not found");
          return;
        }
        const action = await Trigger.findOne({
          id: view.configuration.action_id,
        });
        if (!action) {
          res.status(500).send("Action not found");
          return;
        }
        //console.log("view cfg", view.configuration);

        if (view.configuration.secret !== secret) {
          res.status(401).send("Secret does not match");
          return;
        }
        const { skill_tools } =
          await getState().functions.inspect_agent.run(action);
        const skill_tool = skill_tools.find(
          (st) => toolname === st.function.name,
        );
        if (!skill_tool) {
          res.status(400).send("Tool not found");
          return;
        }
        const row = req.body;
        const resp = await skill_tool.process(row, { req });
        if (typeof resp === "string") res.send(resp);
        else res.json(resp);
      },
    },
  ];
};

module.exports = {
  sc_plugin_api_version: 1,
  configuration_workflow,
  functions,
  routes,
  viewtemplates: (config) => [require("./agent-view")(config)],
};
