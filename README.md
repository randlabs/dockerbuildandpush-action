# dockerbuildandpush-action

A [GitHub Action][github-actions-url] to build and push a docker image into GitHub Container registry written in [TypeScript][typescript-url]

[![License][license-image]][license-url]
[![Issues][issues-image]][issues-url]

## Usage

```YML
    ...
    - name: Build and push docker image
      uses: randlabs/dockerbuildandpush-action@v1.0.0
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      with:
        tag: v1.0.0
    ...
```

### Inputs

```YML
inputs:
  tag:
    description: 'Tag name'
    required: true
  username:
    description: 'Username used to log against the GitHub Container registry. Defaults to {github.actor} context variable.'
    required: false
  password:
    description: 'Password or personal access token used to log against the GitHub Container registry. Defaults to GITHUB_TOKEN environment variable.'
    required: false
  labels:
    description: 'Custom docker image labels.'
    required: false
  dockerfile:
    description: 'Location of the dockerfile file. Defaults to ./dockerfile. If a relative path is given, base path will be the "path" input.'
    required: false
  custom-dockerfile:
    description: 'Custom dockerfile instructions. If present, will override "dockerfile" input.'
    required: false
  path:
    description: 'Relative path under $GITHUB_WORKSPACE to set as the default directory. Defaults to "."'
    required: false
  repo:
    description: 'Target repository in <owner-or-company>/<repository> format. Defaults to the one that fired the action.'
    required: false
```

### Environment variables:

`GITHUB_TOKEN` must be set to the workflow's token or the personal access token (PAT) required to accomplish the task if password input is not provided.

[typescript-url]: http://www.typescriptlang.org/
[github-actions-url]: https://github.com/features/actions
[license-url]: https://github.com/randlabs/dockerbuildandpush-action/blob/master/LICENSE
[license-image]: https://img.shields.io/github/license/randlabs/dockerbuildandpush-action.svg
[issues-url]: https://github.com/randlabs/dockerbuildandpush-action/issues
[issues-image]: https://img.shields.io/github/issues-raw/randlabs/dockerbuildandpush-action.svg
