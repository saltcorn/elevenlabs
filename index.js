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
      description: "Get vector embedding",
      arguments: [
        { name: "options", type: "JSON", tstype: "any", required: true },
      ],
    },
  };
};

const routes = (config) => {
  return [
    {
      url: "/elevenlabs/toolcall",
      method: "get",
      callback: async (req, res) => {
        const { viewname, toolname, secret, ...rest } = req.query;
        const view = View.findOne({ name: viewname });
        if (!view) {
          res.send("View not found");
          return;
        }
        const action = await Trigger.findOne({
          id: view.configuration.action_id,
        });
        if (!action) {
          res.send("Action not found");
          return;
        }
        if (!view.configuration.secret!==secret) {
          res.send("Secret does not match");
          return;
        }
        res.send("Blueberry")
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
