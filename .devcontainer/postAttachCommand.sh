#!/bin/zsh

git branch --merged|egrep -v '\*|develop|main|master'|xargs git branch -d
git config --global --add --bool push.autoSetupRemote true
git config --global --add safe.directory /home/vscode/app
git config --global --unset commit.template
git config --global fetch.prune true
git config --global tag.gpgsign true
git config --global commit.gpgsign true
