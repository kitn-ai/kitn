export interface ComponentRef {
  namespace: string;
  name: string;
  version: string | undefined;
}

export function parseComponentRef(input: string): ComponentRef {
  let namespace = "@kitn";
  let rest = input;

  // Parse @namespace/name
  if (rest.startsWith("@")) {
    const slashIdx = rest.indexOf("/");
    if (slashIdx === -1) {
      throw new Error(`Invalid component reference: ${input}. Expected @namespace/name`);
    }
    namespace = rest.slice(0, slashIdx);
    rest = rest.slice(slashIdx + 1);
  }

  // Parse name@version
  const atIdx = rest.indexOf("@");
  if (atIdx === -1) {
    return { namespace, name: rest, version: undefined };
  }

  return {
    namespace,
    name: rest.slice(0, atIdx),
    version: rest.slice(atIdx + 1),
  };
}
