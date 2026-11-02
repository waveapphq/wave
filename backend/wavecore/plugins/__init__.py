"""WAVE Plugins."""

from wavecore.plugins.csv_parser import CSVParserPlugin
from wavecore.plugins.excel_parser import ExcelParserPlugin
from wavecore.plugins.file_io import FileIOPlugin
from wavecore.plugins.helm_install import HelmInstallPlugin
from wavecore.plugins.helm_rollback import HelmRollbackPlugin
from wavecore.plugins.helm_status import HelmStatusPlugin
from wavecore.plugins.helm_test import HelmTestPlugin
from wavecore.plugins.helm_uninstall import HelmUninstallPlugin
from wavecore.plugins.helm_upgrade import HelmUpgradePlugin
from wavecore.plugins.http_client import HTTPClientPlugin
from wavecore.plugins.json_parser import JSONParserPlugin
from wavecore.plugins.k8s_apply import K8sApplyPlugin
from wavecore.plugins.k8s_connect import K8sConnectPlugin
from wavecore.plugins.k8s_copy import K8sCopyPlugin
from wavecore.plugins.k8s_delete import K8sDeletePlugin
from wavecore.plugins.k8s_events import K8sEventsPlugin
from wavecore.plugins.k8s_exec import K8sExecPlugin
from wavecore.plugins.k8s_get import K8sGetPlugin
from wavecore.plugins.k8s_logs import K8sLogsPlugin
from wavecore.plugins.k8s_rollout import K8sRolloutPlugin
from wavecore.plugins.k8s_scale import K8sScalePlugin
from wavecore.plugins.k8s_script import K8sScriptPlugin
from wavecore.plugins.k8s_top import K8sTopPlugin
from wavecore.plugins.log import LogPlugin
from wavecore.plugins.netcat import NetcatPlugin
from wavecore.plugins.opensearch import OpenSearchPlugin
from wavecore.plugins.ping import PingPlugin
from wavecore.plugins.python import PythonPlugin
from wavecore.plugins.sftp import SFTPPlugin
from wavecore.plugins.shell_exec import ShellExecPlugin
from wavecore.plugins.shell_script import ShellScriptPlugin
from wavecore.plugins.sql_client import SQLClientPlugin
from wavecore.plugins.ssh_session_close import SSHSessionClosePlugin
from wavecore.plugins.ssh_session_exec import SSHSessionExecPlugin
from wavecore.plugins.ssh_session_open import SSHSessionOpenPlugin
from wavecore.plugins.ssh_session_script import SSHSessionScriptPlugin
from wavecore.plugins.ssh_tunnel_close import SSHTunnelClosePlugin
from wavecore.plugins.ssh_tunnel_open import SSHTunnelOpenPlugin
from wavecore.plugins.xml_parser import XMLParserPlugin

__all__ = [
    "CSVParserPlugin",
    "ExcelParserPlugin",
    "FileIOPlugin",
    "HelmInstallPlugin",
    "HelmRollbackPlugin",
    "HelmStatusPlugin",
    "HelmTestPlugin",
    "HelmUninstallPlugin",
    "HelmUpgradePlugin",
    "HTTPClientPlugin",
    "JSONParserPlugin",
    "K8sApplyPlugin",
    "K8sConnectPlugin",
    "K8sCopyPlugin",
    "K8sDeletePlugin",
    "K8sEventsPlugin",
    "K8sExecPlugin",
    "K8sGetPlugin",
    "K8sLogsPlugin",
    "K8sRolloutPlugin",
    "K8sScalePlugin",
    "K8sScriptPlugin",
    "K8sTopPlugin",
    "LogPlugin",
    "NetcatPlugin",
    "OpenSearchPlugin",
    "PingPlugin",
    "PythonPlugin",
    "SFTPPlugin",
    "ShellExecPlugin",
    "ShellScriptPlugin",
    "SQLClientPlugin",
    "SSHSessionClosePlugin",
    "SSHSessionExecPlugin",
    "SSHSessionOpenPlugin",
    "SSHSessionScriptPlugin",
    "SSHTunnelClosePlugin",
    "SSHTunnelOpenPlugin",
    "XMLParserPlugin",
]
