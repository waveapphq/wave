#!/bin/sh
# Adapted from images/cluster/entrypoint.sh, kwok v0.7.0 (https://github.com/kubernetes-sigs/kwok).
# Copyright 2022 The Kubernetes Authors, Apache-2.0. Changed: insecure port off, WAVE's Stages
# and a bootstrap step between create and serve. See NOTICE.
# WAVE kwok entrypoint: write the generated log fixture, create the secure cluster
# (metrics-server enabled from the baked binary), apply the WAVE bootstrap
# manifests, then keep it alive.

export ALIVE=true

catch_exit() {
  ALIVE=false
  kwokctl stop cluster || true
  exit 0
}

keep_alive() {
  while [ "${ALIVE}" = "true" ]; do
    if ! output="$(kwokctl start cluster 2>&1)"; then
      echo "Failed to start cluster: ${output}"
    fi
    sleep 10
  done
}

trap catch_exit EXIT

/wave/generate-logs.sh || exit 1

kwokctl create cluster \
  --config /wave/kwok.yaml \
  --config /wave/stages/node-initialize.yaml \
  --config /wave/stages/node-heartbeat-with-lease.yaml \
  --config /wave/stages/pod-ready.yaml \
  --config /wave/stages/pod-complete.yaml \
  --config /wave/stages/pod-job-fail.yaml \
  --config /wave/stages/pod-helm-test-complete.yaml \
  --config /wave/stages/pod-helm-test-fail.yaml \
  --config /wave/stages/pod-delete.yaml \
  --config /wave/stages/pod-kubelet-events.yaml \
  --config /wave/stages/pod-crash-loop.yaml \
  --config /wave/stages/pod-container-creating.yaml \
  --config /wave/metrics-usage.yaml \
  --enable metrics-server \
  --metrics-server-binary=/wave/bin/metrics-server \
  --kube-apiserver-port=6443 \
  --kube-apiserver-insecure-port=0 \
  --wait=90s || exit 1

# The CRD has to be Established before the same directory's custom resource applies.
kwokctl kubectl apply -f /wave/manifests/crd-wavegadget.yaml || exit 1
kwokctl kubectl wait --for=condition=Established --timeout=60s \
  crd/wavegadgets.wave.e2e || exit 1

kwokctl kubectl apply -f /wave/manifests/ || exit 1

echo "WAVE kwok cluster ready at 0.0.0.0:6443 (secure serving, RBAC, metrics.k8s.io)"

keep_alive
