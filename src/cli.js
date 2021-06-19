import { gql, GraphQLClient } from "graphql-request";
import { cli } from "cli-ux";
import chalk from "chalk";
import jwtDecode from "jwt-decode";
import tar from "tar";
import globby from "globby";
import FormData from "form-data";
import got, { HTTPError } from "got";
import getStream from "get-stream";
import pWaitFor from "p-wait-for";

const { red, blue, green, bold, underline } = chalk;

export const helpText = `
Pushes the current folder to an Ectocet project. Needs ECTOCET_PROJECT_SECRET env var (will ask for it if not provided).
`;

const GET_PROJECT_TOKEN = gql`
  query($secret: UUID!) {
    getProjectToken(secret: $secret)
  }
`;

const GET_PROJECT = gql`
  query($id: UUID!) {
    project(id: $id) {
      namespace
      builds(orderBy: CREATED_AT_DESC, first: 1) {
        nodes {
          result
        }
      }
      team {
        name
        namespace
      }
      postSource {
        fields
        url
      }
      services {
        nodes {
          id
          name
          customDomain
        }
      }
    }
  }
`;

const CREATE_BUILD = gql`
  mutation($projectId: UUID!) {
    createBuild(input: { build: { projectId: $projectId } }) {
      build {
        id
      }
    }
  }
`;

const GET_BUILD = gql`
  query($id: UUID!) {
    build(id: $id) {
      result
    }
  }
`;

const fail = (text) => {
  cli.action.stop(red("✘ FAIL"));
  if (text) cli.log(red(text));
  process.exit(1);
};

const actionSuccess = () => cli.action.stop(green("✔ OK"));

const isUuid = (id) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    id
  );

export const main = async () => {
  const apiOrigin = process.env.ECTOCET_API_ORIGIN || "https://www.ectocet.com";
  const client = new GraphQLClient(`${apiOrigin}/api/graphql`);

  const secret =
    process.env.ECTOCET_PROJECT_SECRET ||
    (await cli.prompt("Project secret", { type: "mask" }));
  if (!isUuid(secret)) fail("Invalid project secret");

  cli.action.start("Getting project info");
  const { getProjectToken: token } = await client.request(GET_PROJECT_TOKEN, {
    secret,
  });
  if (!token) fail("Invalid project secret");
  const id = jwtDecode(token).sub;
  client.setHeader("Authorization", `Bearer ${token}`);
  const {
    project: {
      postSource: { fields, url },
      namespace,
      team,
      builds,
      services,
    },
  } = await client.request(GET_PROJECT, { id });

  if (builds.nodes[0] && !builds.nodes[0].result)
    fail(
      "Project already building, please wait for it to finish before redeploying."
    );

  actionSuccess();

  cli.log(`Using project ${blue(namespace)} of team ${blue(team.name)}`);

  cli.action.start("Packing code");
  const packedFiles = await globby(".", {
    gitignore: true,
    dot: true,
    ignore: ["**/.git"],
  });
  const tarball = await getStream.buffer(tar.c({ gzip: true }, packedFiles));
  actionSuccess();

  cli.action.start("Uploading code");
  const body = new FormData();
  Object.entries(fields).forEach(([name, value]) => body.append(name, value));
  body.append("file", tarball, { knownLength: tarball.length });
  try {
    await got.post(url, { body });
  } catch (e) {
    if (e instanceof HTTPError) fail(e.response.body);
    throw e;
  }
  actionSuccess();

  cli.action.start("Building");
  const {
    createBuild: { build },
  } = await client.request(CREATE_BUILD, { projectId: id });
  let buildResult;
  await pWaitFor(
    async () => {
      const {
        build: { result },
      } = await client.request(GET_BUILD, build);
      if (!result) return false;
      if (result.error) fail(`Deployement failed:\n${result.error.message}`);
      buildResult = result;
      return true;
    },
    { before: false, interval: 5000 }
  );
  actionSuccess();
  cli.log("Done! 🚀");
  cli.log("Services available at:");
  const root = process.env.ECTOCET_API_ORIGIN
    ? "app.dev.ectocet.com"
    : "app.ectocet.com";
  buildResult.serviceBuilds.forEach(({ serviceId }) => {
    const { name, customDomain } = services.nodes.find(
      (s) => s.id === serviceId
    );
    cli.log(
      `- ${underline(
        bold(
          `https://${
            customDomain || `${name}-${namespace}-${team.namespace}.${root}`
          }`
        )
      )}`
    );
  });
};
