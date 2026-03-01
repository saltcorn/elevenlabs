const Field = require("@saltcorn/data/models/field");
const Table = require("@saltcorn/data/models/table");
const Form = require("@saltcorn/data/models/form");
const View = require("@saltcorn/data/models/view");
const File = require("@saltcorn/data/models/file");
const Trigger = require("@saltcorn/data/models/trigger");
const FieldRepeat = require("@saltcorn/data/models/fieldrepeat");
const db = require("@saltcorn/data/db");
const WorkflowRun = require("@saltcorn/data/models/workflow_run");
const Workflow = require("@saltcorn/data/models/workflow");
const { div, script, domReady, a, br, img } = require("@saltcorn/markup/tags");
const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");
const { getState } = require("@saltcorn/data/db/state");

const crypto = require("crypto");

const ensure_final_slash = (s) => (s.endsWith("/") ? s : s + "/");

const configuration_workflow = (modcfg) => (req) =>
  new Workflow({
    onDone: async (ctx, ...rest) => {
      const client = new ElevenLabsClient({
        apiKey: modcfg.api_key,
      });
      const action = await Trigger.findOne({ id: ctx.action_id });
      const { systemPrompt, tools } =
        await getState().functions.inspect_agent.run(action);
      //console.log("tools", JSON.stringify(tools, null, 2));
      if (!ctx.tool_id_hash) ctx.tool_id_hash = {};
      if (!ctx.secret)
        ctx.secret = Math.floor(Math.random() * 16777215).toString(16);

      const tool_ids = [];
      const baseurl = getState().getConfig("base_url", "/");
      for (const tool of tools || []) {
        const hash = crypto
          .createHash("md5")
          .update(JSON.stringify(tool))
          .digest("hex");
        const hashed_name = `${tool.function.name}_${hash}`;
        if (ctx.tool_id_hash[hashed_name])
          tool_ids.push(ctx.tool_id_hash[hashed_name]);
        else {
          const { id } = await client.conversationalAi.tools.create({
            toolConfig: {
              type: "webhook",
              name: tool.function.name,
              description: tool.function.description,

              apiSchema: {
                url: `${ensure_final_slash(baseurl)}elevenlabs/toolcall?viewname=${ctx.viewname}&toolname=${tool.function.name}&secret=${ctx.secret}`,
                method: "POST",
                //pathParamsSchema: {},
                //queryParamsSchema: {},
                requestBodySchema: tool.function.parameters || {},
                requestHeaders: {
                  /* "CSRF-Token": {
                    type: "dynamic_variable",
                    secretId: "",
                    variableName: "crsf",
                  },*/
                },
              },
            },
          });
          ctx.tool_id_hash[hashed_name] = id;
          tool_ids.push(id);
        }
      }

      let prompt;
      if (ctx.dynamic_prompt) {
        prompt = "{{sysprompt}}";
      } else {
        prompt = systemPrompt;
      }
      const conversationConfig = {
        agent: {
          firstMessage: ctx.first_message,
          prompt: {
            prompt,
            toolIds: tool_ids,
          },
        },
      };
      //console.log("conversationConfig", JSON.stringify(conversationConfig, null,2))
      //console.log("agent id", !ctx.elevenlabs_agent_id);

      if (!ctx.elevenlabs_agent_id) {
        const createres = await client.conversationalAi.agents.create({
          conversationConfig,
        });
        ctx.elevenlabs_agent_id = createres.agentId;
      } else {
        await client.conversationalAi.agents.update(ctx.elevenlabs_agent_id, {
          conversationConfig,
        });
        //console.log("updateres", JSON.stringify(updateRes, null,2));
      }
      return ctx;
    },
    steps: [
      {
        name: "Agent action",

        form: async (context) => {
          const agent_actions = await Trigger.find({ action: "Agent" });
          return new Form({
            fields: [
              {
                name: "action_id",
                label: "Agent action",
                type: "String",
                required: true,
                attributes: {
                  options: agent_actions.map((a) => ({
                    label: a.name,
                    name: a.id,
                  })),
                },
                sublabel:
                  "A trigger with <code>Agent</code> action. " +
                  a(
                    {
                      "data-dyn-href": `\`/actions/configure/\${action_id}\``,
                      target: "_blank",
                    },
                    "Configure",
                  ),
              },
              {
                name: "elevenlabs_agent_id",
                label: "11labs Agent ID",
                sublabel: "Leave blank to create a new agent",
                type: "String",
              },
              {
                name: "first_message",
                label: "First message",
                type: "String",
              },
              {
                name: "dynamic_prompt",
                label: "Dynamic prompt",
                type: "Bool",
                sublabel:
                  "Set system prompt individually based on triggering row and/or user",
              },
            ],
          });
        },
      },
    ],
  });

const get_state_fields = async (table_id) =>
  table_id
    ? [
        {
          name: "id",
          type: "Integer",
          primary_key: true,
        },
      ]
    : [];

const run =
  (modcfg) =>
  async (
    table_id,
    viewname,
    { action_id, agent_action, elevenlabs_agent_id, dynamic_prompt },
    state,
    { res, req },
  ) => {
    const action = agent_action || (await Trigger.findOne({ id: action_id }));
    if (!action) throw new Error(`Action not found: ${action_id}`);
    let dynvs = `dynamic-variables='{"csrf": "${req.csrfToken()}"}'`;
    if (dynamic_prompt) {
      let triggering_row;
      if (table_id) {
        const table = Table.findOne(table_id);
        const pk = table?.pk_name;
        if (table && state[pk])
          triggering_row = await table.getRow({ [pk]: state[pk] });
      }
      const { systemPrompt } = await getState().functions.inspect_agent.run(
        action,
        req.user,
        triggering_row,
      );
      dynvs = `dynamic-variables='{"csrf": "${req.csrfToken()}", "sysprompt": ${JSON.stringify(systemPrompt).replaceAll("'", "\\'")}}'`;
    }
    return `<elevenlabs-convai 
       agent-id="${elevenlabs_agent_id}"
       ${dynvs}
       >
       </elevenlabs-convai>
<script src="https://unpkg.com/@elevenlabs/convai-widget-embed" async type="text/javascript"></script>
`;
  };

module.exports = (modcfg) => ({
  name: "ElevenLabs Agent Chat",
  configuration_workflow: configuration_workflow(modcfg),
  display_state_form: false,
  get_state_fields,
  //tableless: true,
  table_optional: true,
  run: run(modcfg),
  //mobile_render_server_side: true,
});
