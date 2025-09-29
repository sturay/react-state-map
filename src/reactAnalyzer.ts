import * as fs from 'fs';
import * as path from 'path';
import ignore from 'ignore';
import {parse} from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';

export interface ComponentData {
  id : string;
  filePath : string;
  name : string;
  x : number;
  y : number;
  width : number;
  height : number;
  items : ComponentItem[];
}

export interface ComponentItem {
  id : string;
  name : string;
  type : 'state' | 'setter' | 'prop' | 'prop-function' | 'function' | 'context-provider' | 'context-consumer';
  color : string;
  flowId : string;
}

export interface DataFlow {
  id : string;
  fromItem : string;
  toItem : string;
  type : string;
}

export interface ConflictData {
  id : string;
  description : string;
  items : string[];
}

export interface AnalysisResult {
  components : ComponentData[];
  flows : DataFlow[];
  conflicts : ConflictData[];
  debug : DebugInfo;
}

export interface DebugInfo {
  filesAnalyzed : string[];
  componentsFound : string[];
  parseErrors : string[];
  analysisLog : string[];
}

export class ReactAnalyzer {
  private debugInfo : DebugInfo = {
    filesAnalyzed: [],
    componentsFound: [],
    parseErrors: [],
    analysisLog: []
  };

  async analyzeReactProject(projectPath : string) : Promise < AnalysisResult > {
    this.debugInfo = {
      filesAnalyzed: [],
      componentsFound: [],
      parseErrors: [],
      analysisLog: []
    };

    this
      .debugInfo
      .analysisLog
      .push(`Starting analysis of: ${projectPath}`);

    const reactFiles = await this.findReactFiles(projectPath);
    this
      .debugInfo
      .analysisLog
      .push(`Found ${reactFiles.length} React files`);

    const components: ComponentData[] = [];
    const flows: DataFlow[] = [];

    for (const filePath of reactFiles) {
      this
        .debugInfo
        .filesAnalyzed
        .push(filePath);
      try {
        this
          .debugInfo
          .analysisLog
          .push(`Analyzing file: ${filePath}`);
        const fileComponents = await this.analyzeFile(filePath);
        components.push(...fileComponents);

        fileComponents.forEach(comp => {
          this
            .debugInfo
            .componentsFound
            .push(`${comp.name} (${comp.items.length} items)`);
        });
      } catch (error) {
        const errorMsg = `Error analyzing ${filePath}: ${error}`;
        this
          .debugInfo
          .parseErrors
          .push(errorMsg);
        console.error(errorMsg);
      }
    }

    this
      .debugInfo
      .analysisLog
      .push(`Total components found: ${components.length}`);

    // For now, create some basic flows between components that share similar prop
    // names
    const generatedFlows = this.generateBasicFlows(components);
    flows.push(...generatedFlows);

    return {
      components: this.layoutComponents(components),
      flows,
      conflicts: [],
      debug: this.debugInfo
    };
  }

  private async findReactFiles(projectPath : string) : Promise < string[] > {
    const reactFiles: string[] = [];

    const scanDirectory = (dirPath : string) => {
      if (dirPath.includes('.next') || 
          dirPath.includes('node_modules') || 
          dirPath.includes('.git')
        ) 
        return;
      
      try {
        const items = fs.readdirSync(dirPath);

        for (const item of items) {
          const fullPath = path.join(dirPath, item);
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory()) {
            scanDirectory(fullPath);
          } else if (/\.(jsx?|tsx?)$/.test(item)) {
            reactFiles.push(fullPath);
          }
        }
      } catch (error) {
        this
          .debugInfo
          .parseErrors
          .push(`Error reading directory ${dirPath}: ${error}`);
      }
    };

    if (fs.statSync(projectPath).isFile()) {
      reactFiles.push(projectPath);
    } else {
      scanDirectory(projectPath);
    }

    return reactFiles;
  }

  private async analyzeFile(filePath : string) : Promise < ComponentData[] > {
    const code = fs.readFileSync(filePath, 'utf-8');
    const components: ComponentData[] = [];

    this
      .debugInfo
      .analysisLog
      .push(`Reading file: ${path.basename(filePath)} (${code.length} chars)`);

    try {
      const ast = parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript', 'decorators-legacy', 'classProperties']
      });

      this
        .debugInfo
        .analysisLog
        .push(`Successfully parsed AST for ${path.basename(filePath)}`);

      traverse(ast, {
        // Function components (function declarations)
        FunctionDeclaration: (path) => {
          const name : any = path.node.id
            ?.name;
          this
            .debugInfo
            .analysisLog
            .push(`Found function declaration: ${name}`);

          if (this.isReactComponent(path.node, name)) {
            this
              .debugInfo
              .analysisLog
              .push(`✓ ${name} identified as React component`);
            const component = this.analyzeComponent(path.node, filePath, name);
            if (component) {
              components.push(component);
            }
          } else {
            this
              .debugInfo
              .analysisLog
              .push(`✗ ${name} not identified as React component`);
          }
        },

        // Arrow function components
        VariableDeclarator: (path) => {
          if (t.isIdentifier(path.node.id)) {
            const name = path.node.id.name;

            if (t.isArrowFunctionExpression(path.node.init) || t.isFunctionExpression(path.node.init)) {

              this
                .debugInfo
                .analysisLog
                .push(`Found arrow/function expression: ${name}`);

              if (this.isReactComponent(path.node.init, name)) {
                this
                  .debugInfo
                  .analysisLog
                  .push(`✓ ${name} identified as React component`);
                const component = this.analyzeComponent(path.node, filePath, name);
                if (component) {
                  components.push(component);
                }
              } else {
                this
                  .debugInfo
                  .analysisLog
                  .push(`✗ ${name} not identified as React component`);
              }
            }
          }
        },

        // Class components
        ClassDeclaration: (path) => {
          const name = path.node.id
            ?.name;
          this
            .debugInfo
            .analysisLog
            .push(`Found class declaration: ${name}`);

          if (this.isReactClassComponent(path.node)) {
            this
              .debugInfo
              .analysisLog
              .push(`✓ ${name} identified as React class component`);
            const component = this.analyzeClassComponent(path.node, filePath);
            if (component) {
              components.push(component);
            }
          } else {
            this
              .debugInfo
              .analysisLog
              .push(`✗ ${name} not identified as React class component`);
          }
        }
      });

    } catch (error) {
      const errorMsg = `Error parsing ${filePath}: ${error}`;
      this
        .debugInfo
        .parseErrors
        .push(errorMsg);
      console.error(errorMsg);
    }

    this
      .debugInfo
      .analysisLog
      .push(`Found ${components.length} components in ${path.basename(filePath)}`);
    return components;
  }

  private isReactComponent(node : any, name?: string) : boolean {
    // Check if function name starts with uppercase (React convention)
    if(name && !/^[A-Z]/.test(name)) {
      return false;
    }

    // Check if function returns JSX
    let hasJSX = false;
    let hasReturn = false;

    try {
      traverse(node, {
        ReturnStatement: (path : any) => {
          console.log(`(hasJSX()) -> path = ${path}`)
          hasReturn = true;
          if (path.node.argument) {
            if (t.isJSXElement(path.node.argument) || t.isJSXFragment(path.node.argument) || t.isJSXText(path.node.argument)) {
              hasJSX = true;
            }
          }
        },
        JSXElement: () => {
          hasJSX = true;
        },
        JSXFragment: () => {
          hasJSX = true;
        }
      }, undefined, (path : any) => path.skip()); // Prevent infinite traversal

    } catch (error) {
      this
        .debugInfo
        .analysisLog
        .push(`Error checking JSX for ${name}: ${error}`);
    }

    const isComponent = hasJSX || (hasReturn && name && /^[A-Z]/.test(name));
    this
      .debugInfo
      .analysisLog
      .push(`${name}: hasJSX=${hasJSX}, hasReturn=${hasReturn}, isComponent=${isComponent}`);

    return isComponent;
  }

  private isReactClassComponent(node : t.ClassDeclaration) : boolean {
    if(!node.superClass) 
      return false;
    
    // Check for extends React.Component or extends Component
    if (t.isMemberExpression(node.superClass)) {
      return t.isIdentifier(node.superClass.property) && node.superClass.property.name === 'Component';
    }

    if (t.isIdentifier(node.superClass)) {
      return node.superClass.name === 'Component';
    }

    return false;
  }

  private analyzeComponent(node : any, filePath : string, componentName : string) : ComponentData | null {
    if(!componentName) 
      return null;
    
    const items: ComponentItem[] = [];
    let itemCounter = 0;

    this
      .debugInfo
      .analysisLog
      .push(`Analyzing component: ${componentName}`);

    try {
      traverse(node, {
        CallExpression: (path) => {
          const callee = path.node.callee;

          if (t.isIdentifier(callee)) {
            // useState hook
            if (callee.name === 'useState') {
              this
                .debugInfo
                .analysisLog
                .push(`Found useState in ${componentName}`);

              const parent = path.parent;
              if (t.isVariableDeclarator(parent) && t.isArrayPattern(parent.id)) {
                const elements = parent.id.elements;
                if (elements.length >= 2) {
                  const stateName = t.isIdentifier(elements[0])
                    ? elements[0].name
                    : `state${itemCounter++}`;
                  const setterName = t.isIdentifier(elements[1])
                    ? elements[1].name
                    : `setter${itemCounter++}`;

                  this
                    .debugInfo
                    .analysisLog
                    .push(`  State: ${stateName}, Setter: ${setterName}`);

                  items.push({id: `${componentName}-${stateName}`, name: stateName, type: 'state', color: '#22c55e', flowId: `${stateName}-flow`});

                  items.push({id: `${componentName}-${setterName}`, name: setterName, type: 'setter', color: '#10b981', flowId: `${stateName}-flow`});
                }
              }
            }

            // useReducer hook
            if (callee.name === 'useReducer') {
              this
                .debugInfo
                .analysisLog
                .push(`Found useReducer in ${componentName}`);

              const parent = path.parent;
              if (t.isVariableDeclarator(parent) && t.isArrayPattern(parent.id)) {
                const elements = parent.id.elements;
                if (elements.length >= 2) {
                  const stateName = t.isIdentifier(elements[0])
                    ? elements[0].name
                    : `state${itemCounter++}`;
                  const dispatchName = t.isIdentifier(elements[1])
                    ? elements[1].name
                    : `dispatch${itemCounter++}`;

                  this
                    .debugInfo
                    .analysisLog
                    .push(`  Reducer State: ${stateName}, Dispatch: ${dispatchName}`);

                  items.push({id: `${componentName}-${stateName}`, name: stateName, type: 'state', color: '#22c55e', flowId: `${stateName}-flow`});

                  items.push({id: `${componentName}-${dispatchName}`, name: dispatchName, type: 'setter', color: '#10b981', flowId: `${stateName}-flow`});
                }
              }
            }

            // useContext hook
            if (callee.name === 'useContext') {
              this
                .debugInfo
                .analysisLog
                .push(`Found useContext in ${componentName}`);

              const parent = path.parent;
              if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
                items.push({id: `${componentName}-${parent.id.name}`, name: `${parent.id.name}()`, type: 'context-consumer', color: '#8b5cf6', flowId: `${parent.id.name}-context`});
              }
            }
          }

          // Context Provider detection
          if (t.isMemberExpression(callee) && t.isIdentifier(callee.property) && callee.property.name === 'Provider') {

            const contextName = t.isIdentifier(callee.object)
              ? callee.object.name
              : 'Context';
            this
              .debugInfo
              .analysisLog
              .push(`Found Context Provider: ${contextName}`);

            items.push({id: `${componentName}-${contextName}Provider`, name: `${contextName}Provider`, type: 'context-provider', color: '#ec4899', flowId: `${contextName}-context`});
          }
        },

        // Function declarations within component
        FunctionDeclaration: (path) => {
          if (path.node.id && path.node.id.name !== componentName) {
            this
              .debugInfo
              .analysisLog
              .push(`Found function: ${path.node.id.name}`);
            items.push({id: `${componentName}-${path.node.id.name}`, name: path.node.id.name, type: 'function', color: '#3b82f6', flowId: `${path.node.id.name}-flow`});
          }
        },

        // Arrow functions assigned to variables
        VariableDeclarator: (path) => {
          if (t.isArrowFunctionExpression(path.node.init) && t.isIdentifier(path.node.id)) {
            this
              .debugInfo
              .analysisLog
              .push(`Found arrow function: ${path.node.id.name}`);
            items.push({id: `${componentName}-${path.node.id.name}`, name: path.node.id.name, type: 'function', color: '#3b82f6', flowId: `${path.node.id.name}-flow`});
          }
        }
      }, undefined, (path : any) => path.skip());

    } catch (error) {
      this
        .debugInfo
        .analysisLog
        .push(`Error analyzing component ${componentName}: ${error}`);
    }

    // Analyze props
    const props = this.extractProps(node, componentName);
    items.push(...props.map(prop => ({id: `${componentName}-${prop}`, name: prop, type: 'prop' as const, color: '#f59e0b', flowId: `${prop}-flow`})));

      this
        .debugInfo
        .analysisLog
        .push(`Component ${componentName} analysis complete: ${items.length} items found`);

      return {
        id: componentName,
        filePath,
        name: componentName,
        x: 0,
        y: 0,
        width: Math.max(200, componentName.length * 8 + 40),
        height: Math.max(100, items.length * 18 + 60),
        items
      };
    }

    private analyzeClassComponent(node : t.ClassDeclaration, filePath : string) : ComponentData | null {
      const componentName = node.id
        ?.name;
      if (!componentName) 
        return null;
      
      const items: ComponentItem[] = [];

      this
        .debugInfo
        .analysisLog
        .push(`Analyzing class component: ${componentName}`);

      try {
        traverse(node, {
          ClassMethod: (path) => {
            if (t.isIdentifier(path.node.key)) {
              const methodName = path.node.key.name;
              if (methodName !== 'render' && methodName !== 'constructor') {
                this
                  .debugInfo
                  .analysisLog
                  .push(`Found class method: ${methodName}`);
                items.push({id: `${componentName}-${methodName}`, name: methodName, type: 'function', color: '#3b82f6', flowId: `${methodName}-flow`});
              }
            }
          }
        }, undefined, (path : any) => path.skip());

      } catch (error) {
        this
          .debugInfo
          .analysisLog
          .push(`Error analyzing class component ${componentName}: ${error}`);
      }

      return {
        id: componentName,
        filePath,
        name: componentName,
        x: 0,
        y: 0,
        width: Math.max(200, componentName.length * 8 + 40),
        height: Math.max(100, items.length * 18 + 60),
        items
      };
    }

    private extractProps(node : any, componentName : string) : string[] {
      const props : string[] = [];

      this
        .debugInfo
        .analysisLog
        .push(`Extracting props for: ${componentName}`);

      try {
        traverse(node, {
          // Look for function parameters - first parameter is usually props
          Function: (path) => {
            if (path.node.params.length > 0) {
              const firstParam = path.node.params[0];

              // Destructured props: function Component({prop1, prop2}) {}
              if (t.isObjectPattern(firstParam)) {
                firstParam
                  .properties
                  .forEach(prop => {
                    if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                      props.push(prop.key.name);
                      this
                        .debugInfo
                        .analysisLog
                        .push(`  Found destructured prop: ${prop.key.name}`);
                    }
                  } // Regular props: function Component(props) {} - then look for props.something
                  );
              } else if (t.isIdentifier(firstParam) && firstParam.name === 'props') {
                // We'll catch props.something usage below
                this
                  .debugInfo
                  .analysisLog
                  .push(`  Found props parameter`);
              }
            }
          },

          // Look for props.something usage
          MemberExpression: (path) => {
            if (t.isIdentifier(path.node.object) && path.node.object.name === 'props' && t.isIdentifier(path.node.property)) {

              if (!props.includes(path.node.property.name)) {
                props.push(path.node.property.name);
                this
                  .debugInfo
                  .analysisLog
                  .push(`  Found prop usage: props.${path.node.property.name}`);
              }
            }
          }
        }, undefined, (path : any) => path.skip());

      } catch (error) {
        this
          .debugInfo
          .analysisLog
          .push(`Error extracting props for ${componentName}: ${error}`);
      }

      this
        .debugInfo
        .analysisLog
        .push(`Extracted ${props.length} props for ${componentName}: [${props.join(', ')}]`);
      return props;
    }

    private generateBasicFlows(components : ComponentData[]) : DataFlow[] {
      const flows : DataFlow[] = [];

      // Simple heuristic: if multiple components have props/state with similar names,
      // assume they might be related
      const propNames = new Map < string,
        ComponentData[] > ();

      components.forEach(component => {
        component
          .items
          .forEach(item => {
            if (item.type === 'prop' || item.type === 'state') {
              if (!propNames.has(item.name)) {
                propNames.set(item.name, []);
              }
              propNames.get(item.name)!.push(component);
            }
          });
      });

      // Create flows between components that share prop names
      propNames.forEach((componentList, propName) => {
        if (componentList.length > 1) {
          this
            .debugInfo
            .analysisLog
            .push(`Creating flow for shared prop: ${propName}`);

          for (let i = 0; i < componentList.length - 1; i++) {
            const fromComponent = componentList[i];
            const toComponent = componentList[i + 1];

            const fromItem = fromComponent
              .items
              .find(item => item.name === propName && item.type === 'state');
            const toItem = toComponent
              .items
              .find(item => item.name === propName && item.type === 'prop');

            if (fromItem && toItem) {
              flows.push({id: `${propName}-flow`, fromItem: fromItem.id, toItem: toItem.id, type: 'state-to-prop'});
            }
          }
        }
      });

      this
        .debugInfo
        .analysisLog
        .push(`Generated ${flows.length} basic flows`);
      return flows;
    }

    private layoutComponents(components : ComponentData[]) : ComponentData[] {
      // Simple grid layout
      const cols = Math.ceil(Math.sqrt(components.length));
      const spacing = 50;

      return components.map((component, index) => ({
        ...component,
        x: (index % cols) * (component.width + spacing) + 50,
        y: Math.floor(index / cols) * (component.height + spacing) + 50
      }));
    }
  }