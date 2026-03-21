const packageJson = require("./package.json")
const name = packageJson.name
const prefix = name === "claude-dev" || name === "marie-coder" ? "codemarie" : name
console.log({ name, prefix, command: `${prefix}.settingsButtonClicked` })
