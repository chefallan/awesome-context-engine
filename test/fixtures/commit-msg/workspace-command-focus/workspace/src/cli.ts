export function run(command) {
  switch (command) {
    case "scan":
      return "scan";
    case "doctor":
      return "doctor";
    default:
      return "unknown";
  }
}