#!/bin/bash
set -o allexport
source .env
set +o allexport
echo "FedMgr environment variables loaded from .env file:"
env |grep "FEDMGR"