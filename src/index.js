const { Command, flags } = require("@oclif/command");

class EctocetCommand extends Command {
  async run() {
    const {
      flags: { name },
    } = this.parse(EctocetCommand);
    this.log(`hello ${name} from ./src/index.js`);
  }
}

EctocetCommand.description = `Describe the command here
...
Extra documentation goes here
`;

EctocetCommand.flags = {
  // add --version flag to show CLI version
  version: flags.version({ char: "v" }),
  // add --help flag to show CLI version
  help: flags.help({ char: "h" }),
  name: flags.string({ char: "n", description: "name to print" }),
};

module.exports = EctocetCommand;
