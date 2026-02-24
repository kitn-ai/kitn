import { addCommand } from "./add.js";

export async function updateCommand(components: string[]) {
  await addCommand(components, { overwrite: true });
}
