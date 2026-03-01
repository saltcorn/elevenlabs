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
        
        if (view.configuration.secret!==secret) {
          res.status(401).send("Secret does not match");
          return;
        }
        const { skill_tools } =
          await getState().functions.inspect_agent.run(action);        
        const skill_tool = skill_tools.find(st=>toolname === st.function.name)
        if (!skill_tool) {
          res.status(400).send("Tool not found");
          return;
        }
        const row = {};
        const resp = await skill_tool.process(row, {req});
        if(typeof resp==="string") res.send(resp);
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
