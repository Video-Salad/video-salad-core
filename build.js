const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const ESMtsconfig = require('./tsconfig.mjs.json');
const CJStsconfig = require('./tsconfig.cjs.json');

// Function to build and watch a TypeScript project
function buildAndWatchProject(tsconfigPath, watch = false, prefix = '', silent = false) {
    const buildCommand = `tsc -p ${tsconfigPath}${watch ? ' --watch' : ''}`;

    // Execute the build command
    const childProcess = exec(buildCommand, { cwd: __dirname });

    // Log the build output
    childProcess.stdout.on('data', (data) => {
        if (!silent) {
            console.log(prefix, data);
        }
    });

    // Handle build errors
    childProcess.stderr.on('data', (data) => {
        if (!silent) {
            console.error(prefix, data);
        }
    });

    return childProcess;
}

// Function to insert package.json with "type" property in project's output folder
function insertPackageJson(projectPath, type = 'module') {
    const packageJsonPath = path.join(__dirname, projectPath, 'package.json');

    const modifiedPackageJson = { type };

    // Recursively create the output folder
    fs.mkdirSync(path.dirname(packageJsonPath), { recursive: true });
    // Write package.json to the output folder
    fs.writeFileSync(packageJsonPath, JSON.stringify(modifiedPackageJson, null, 2),);
}

// Get first commandline argument
const tsWatch = process.argv.length > 2 && process.argv[2].toLowerCase() === 'watch';

// Build and watch the first TypeScript project
const ESMPath = ESMtsconfig.compilerOptions.outDir;
const ESMtsconfigPath = 'tsconfig.mjs.json';

buildAndWatchProject(ESMtsconfigPath, tsWatch, '[ESM]');
insertPackageJson(ESMPath, 'module');

// Build and watch the second TypeScript project
const CJSPath = CJStsconfig.compilerOptions.outDir;
const CJStsconfigPath = 'tsconfig.cjs.json';

buildAndWatchProject(CJStsconfigPath, tsWatch, '[CJS]', true);
insertPackageJson(CJSPath, 'commonjs');
