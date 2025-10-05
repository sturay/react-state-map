import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {ReactAnalyzer} from './reactAnalyzer';
import {VisualizerPanel} from './visualizerPanel';

export function activate(context : vscode.ExtensionContext) {
  console.log('React Component Visualizer is now active!');

  const analyzer = new ReactAnalyzer();
  let currentPanel : VisualizerPanel | undefined = undefined;

  // Command to show the diagram
  const showDiagramCommand = vscode
    .commands
    .registerCommand('reactVisualizer.showDiagram', async(uri?: vscode.Uri) => {
      try {
        if (currentPanel) {
          currentPanel.reveal();
        } else {
          currentPanel = new VisualizerPanel(context.extensionUri);
          currentPanel.onDidDispose(() => {
            currentPanel = undefined;
          });
        }

        // Analyze workspace or specific file
        const workspaceFolder = vscode.workspace.workspaceFolders
          ?.[0];
        if (!workspaceFolder) {
          vscode
            .window
            .showErrorMessage('No workspace folder found');
          return;
        }

        vscode
          .window
          .showInformationMessage('Analyzing React components...');

        const targetPath = uri
          ? uri.fsPath
          : workspaceFolder.uri.fsPath;
        console.log('Analyzing path:', targetPath);

        const analysisResult = await analyzer.analyzeReactProject(targetPath);

        console.log('Analysis complete:', {
          components: analysisResult.components.length,
          flows: analysisResult.flows.length,
          conflicts: analysisResult.conflicts.length
        });

        if (currentPanel) {
          console.log('Sending data to webview...');
          currentPanel.updateVisualization(analysisResult);
        }

        vscode
          .window
          .showInformationMessage(`Found ${analysisResult.components.length} React components`);

      } catch (error) {
        console.error('Analysis error:', error);
        vscode
          .window
          .showErrorMessage(`Error analyzing React components: ${error}`);
      }
    });

  // Command to analyze current file
  const analyzeCurrentCommand = vscode
    .commands
    .registerCommand('reactVisualizer.analyzeCurrent', async() => {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        vscode
          .window
          .showErrorMessage('No active file');
        return;
      }

      const filePath = activeEditor.document.uri.fsPath;
      if (!/\.(js|jsx|ts|tsx)$/.test(filePath)) {
        vscode
          .window
          .showErrorMessage('Please open a React file');
        return;
      }

      vscode
        .commands
        .executeCommand('reactVisualizer.showDiagram', activeEditor.document.uri);
    });

  // Command to analyze entire workspace
  const analyzeWorkspaceCommand = vscode
    .commands
    .registerCommand('reactVisualizer.analyzeWorkspace', () => {
      vscode
        .commands
        .executeCommand('reactVisualizer.showDiagram');
    });

  // Register file watcher for auto-refresh
  const config = vscode
    .workspace
    .getConfiguration('reactVisualizer');
  if (config.get('autoRefresh')) {
    const watcher = vscode
      .workspace
      .createFileSystemWatcher('**/*.{js,jsx,ts,tsx}');

    const refreshDiagram = () => {
      if (currentPanel) {
        vscode
          .commands
          .executeCommand('reactVisualizer.showDiagram');
      }
    };

    watcher.onDidChange(refreshDiagram);
    watcher.onDidCreate(refreshDiagram);
    watcher.onDidDelete(refreshDiagram);

    context
      .subscriptions
      .push(watcher);
  }

  // Set context for when clause
  const hasReactFiles = async() => {
    const reactFiles = await vscode
      .workspace
      .findFiles('**/*.{jsx,tsx}', '**/node_modules/**', 1);
    await vscode
      .commands
      .executeCommand('setContext', 'workspaceHasReactFiles', reactFiles.length > 0);
  };

  hasReactFiles();

  context
    .subscriptions
    .push(showDiagramCommand, analyzeCurrentCommand, analyzeWorkspaceCommand);
}

export function deactivate() {}