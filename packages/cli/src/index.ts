import { Command } from "commander";

const program = new Command()
  .name("kitn")
  .description("Install AI agent components from the kitn registry")
  .version("0.1.0");

program.parse();
