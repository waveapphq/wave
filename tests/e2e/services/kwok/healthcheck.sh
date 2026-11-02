#!/bin/sh
# Authenticated /readyz, an authenticated read of the bootstrap-applied
# `restricted` namespace, and metrics.k8s.io discovery: healthy also proves
# token auth + RBAC + bootstrap + the aggregated metrics-server.
curl -ksf -H "Authorization: Bearer wave-admin-token" https://127.0.0.1:6443/readyz || exit 1
curl -ksf -o /dev/null -H "Authorization: Bearer wave-admin-token" https://127.0.0.1:6443/api/v1/namespaces/restricted || exit 1
curl -ksf -o /dev/null -H "Authorization: Bearer wave-admin-token" https://127.0.0.1:6443/apis/metrics.k8s.io/v1beta1 || exit 1
