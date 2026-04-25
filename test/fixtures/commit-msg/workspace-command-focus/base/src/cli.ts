export function run(command) {
  switch (command) {
    case "scan":
      return "scan";
    default:
      return "unknown";
  }
}