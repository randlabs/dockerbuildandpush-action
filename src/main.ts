import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// -----------------------------------------------------------------------------

const REGISTRY_URL = 'ghcr.io';

// -----------------------------------------------------------------------------

async function run(): Promise<void> {
	let dockerfile = '';
	let deleteDockerfile = false;
	let logoutDocker = false;

	try {
		// Ensure the github token is passed through password input or environment variables
		let token = core.getInput('password');
		if (!token) {
			token = process.env.GITHUB_TOKEN || '';
			if (!token) {
				throw new Error('Input password not provided and GITHUB_TOKEN environment variable not found');
			}
		}

		// Get username
		let username = core.getInput('username');
		if (!username) {
			username = github.context.actor;
			if (!username) {
				throw new Error('Inputnode username not provided and unable to determine the current actor');
			}
		}

		// Get tag
		const tagName = core.getInput('tag', { required: true });
		if (!tagName) {
			throw new Error('Missing tag input');
		}

		// Get custom defined labels
		const buildLabels = core.getMultilineInput('labels');
		for (const label of buildLabels) {
			if (label.indexOf('\'') || label.indexOf(' ') || label.indexOf('\t')) {
				throw new Error('The apostrophe character, spaces and tabs are not allowed on labels');
			}
			const equalSignPos = label.indexOf('=');
			if (equalSignPos <= 0 || equalSignPos >= label.length - 1) {
				throw new Error('Label format must be NAME=VALUE');
			}
			if (label.startsWith('org.opencontainers.image.source=')) {
				throw new Error('Label "org.opencontainers.image.source" will be automatically added and cannot be overriden');
			}
		}

		// Get workspace directory
		const workspacePath = process.env['GITHUB_WORKSPACE'];
		if (!workspacePath) {
		  throw new Error('GITHUB_WORKSPACE not defined');
		}
	  
		// Get path
		let basepath = core.getInput('path');
		if (basepath) {
			if (path.isAbsolute(basepath)) {
				throw new Error('Input path cannot be absolute');
			}
			basepath = path.resolve(workspacePath, basepath);
		}
		else {
			basepath = path.resolve(workspacePath);
		}

		// Get dockerfile (or custom)
		const customDockerfile = core.getMultilineInput('customdockerfile');
		if (customDockerfile.length > 0) {
			// If a custom dockerfile content is provided, generate a new temporary file and save the content there
			dockerfile = generateTempFilename();
			fs.writeFileSync(dockerfile, customDockerfile.join(os.EOL));

			// Mark the file to be deleted at the end of the script execution
			deleteDockerfile = true;
		}
		else {
			dockerfile = core.getInput('dockerfile');
			if (path.isAbsolute(dockerfile)) {
				throw new Error('Input path cannot be absolute');
			}
			dockerfile = path.resolve(basepath, dockerfile);
		}

		// Create the GitHub accessor
		const octokit = github.getOctokit(token);

		// Get target owner and repository
		let { repo, owner } = github.context.repo;
		const ownerRepo = core.getInput('repo');
		if (ownerRepo) {
			const ownerRepoItems = ownerRepo.split('/');
			if (ownerRepoItems.length != 2) {
				throw new Error('the specified `repo` is invalid');
			}
			owner = ownerRepoItems[0].trim();
			repo = ownerRepoItems[1].trim();
			if (owner.length == 0 || repo.length == 0) {
				throw new Error('the specified `repo` is invalid');
			}
		}

		// Prepare to build image
		core.info('Building image');

		// Run docker build
		try {
			let args: string[] = [ 'build' ];
			args.push('--no-cache');
			args.push('--progress', 'tty');
			args.push('--file', dockerfile);
			args.push('--tag', 'ghcr.io/' + owner + '/' + repo + ':' + tagName);
			for (const label of buildLabels) {
				args.push('--label', label);
			}
			args.push('--label', 'org.opencontainers.image.source=https://github.com/' + owner + '/' + repo);
			args.push('.');

			const res = await exec.getExecOutput('docker', args, {
				ignoreReturnCode: true,
				cwd: basepath
			});
			if (res.exitCode != 0) {
				throw new Error(res.stderr.trim());
			}
		}
		catch (err: any) {
			let msg = 'Unable to complete docker build image process';
			if (err.toString) {
				// eslint-disable-next-line @typescript-eslint/restrict-plus-operands
				msg += ' [' + err.toString() + ']';
			}
			throw new Error(msg);
		}
		
		// Login into Github's Docker registry
		core.info('Logging into Github\'s Docker registry');

		// Run docker login
		try {
			let args: string[] = [ 'login' ];
			args.push('--username', username);
			args.push('--password-stdin');
			args.push(REGISTRY_URL);

			const res = await exec.getExecOutput('docker', args, {
				ignoreReturnCode: true,
				cwd: basepath,
				input: Buffer.from(token)
			});
			if (res.exitCode != 0) {
				throw new Error(res.stderr.trim());
			}
		}
		catch (err: any) {
			let msg = 'Unable to complete docker login process';
			if (err.toString) {
				// eslint-disable-next-line @typescript-eslint/restrict-plus-operands
				msg += ' [' + err.toString() + ']';
			}
			throw new Error(msg);
		}

		// Delete any existing image with the same tag
		core.info('Checking for existing tagged container package');
		let packageId = 0;
		for (let page = 1; packageId == 0 && page <= 20; page += 1) {
			try {
				const packagesInfo = await octokit.rest.packages.getAllPackageVersionsForPackageOwnedByOrg({
					package_type: 'container',
					package_name: repo,
					org: owner,
					page,
					per_page: 100,
					state: 'active'
				});
				if (packagesInfo.status !== 200) {
					throw new Error('Failed to retrieve the list of images');
				}
				core.info(JSON.stringify(packagesInfo.data));
				for (const pkg of packagesInfo.data) {
					if (pkg.metadata && pkg.metadata.container && pkg.metadata.container.tags) {
						for (const tag of pkg.metadata.container.tags) {
							core.info(JSON.stringify({tag, tagName}));
							if (tag == tagName) {
								// found!
								core.info('-> Found. Deleting...');
	
								packageId = pkg.id;
								break;
							}
						}
						if (packageId != 0) {
							break;
						}
					}
				}
				if (packagesInfo.data.length < 100) {
					break;
				}
			}
			catch (err: any) {
				// Handle release not found error
				if (err.status !== 404 && err.message !== 'Not Found') {
					throw err;
				}
				break;
			}
		}
		if (packageId > 0) {
			try {
				const deleteInfo = await octokit.rest.packages.deletePackageForOrg({
					package_type: 'container',
					package_name: repo,
					org: owner,
					id: packageId
				});

				// Check status to ensure the package was deleted
				if (deleteInfo.status !== 204) {
					throw new Error('Failed to delete existing package');
				}
			}
			catch (err: any) {
				// Handle release not found error
				if (err.status !== 404 && err.message !== 'Not Found') {
					throw err;
				}
			}
		}

		// Prepare to push image
		core.info('Pushing image');

		// Run docker push
		try {
			let args: string[] = [ 'push' ];
			args.push('ghcr.io/' + owner + '/' + repo + ':' + tagName);

			const res = await exec.getExecOutput('docker', args, {
				ignoreReturnCode: true,
				cwd: basepath
			});
			if (res.exitCode != 0) {
				throw new Error(res.stderr.trim());
			}
		}
		catch (err: any) {
			let msg = 'Unable to complete docker build image process';
			if (err.toString) {
				// eslint-disable-next-line @typescript-eslint/restrict-plus-operands
				msg += ' [' + err.toString() + ']';
			}
			throw new Error(msg);
		}
	}
	catch (err: any) {
		if (err instanceof Error) {
			core.setFailed(err.message);
		}
		else if (err.toString) {
			core.setFailed(err.toString());
		}
		else {
			core.setFailed('unknown error');
		}
	}
	finally {
		// Delete temporary dockerfile is any
		if (deleteDockerfile) {
			try {
				fs.unlinkSync(dockerfile);
			}
			catch (err: any) {
				// ignore error and keep linter happy
			}
		}

		// Logout docker registry
		if (logoutDocker) {
			try {
				const res = await exec.getExecOutput('docker', ['logout', REGISTRY_URL], { ignoreReturnCode: true })
				if (res.stderr.length > 0 && res.exitCode != 0) {
					core.warning(res.stderr.trim());
				}
			}
			catch (err: any) {
				// ignore error and keep linter happy
			}
		}
	}
}

function generateTempFilename(): string {
	const dir = path.resolve(os.tmpdir());
	const now = new Date();
	const filename = [
		'dbp',
		now.getFullYear(), now.getMonth(), now.getDate(),
		'-',
		process.pid,
		'-',
		(Math.random() * 0x100000000 + 1).toString(36)
	].join('');
	return path.join(dir, filename);
}

// -----------------------------------------------------------------------------

run();
