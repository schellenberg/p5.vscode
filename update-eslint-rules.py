import requests
import re
import os
import json

# URL of the p5.js reference JSON file
p5js_reference_url = 'https://raw.githubusercontent.com/processing/p5.js-website/refs/heads/main/public/reference/data.json'

# Path to the eslint.config.mjs file
eslint_config_path = os.path.join(os.path.dirname(__file__), 'template/eslint.config.mjs')

# Fetch the p5.js reference JSON file
response = requests.get(p5js_reference_url)
if response.status_code != 200:
    print(f'Error fetching p5.js reference JSON: {response.status_code}')
    exit(1)

# Parse the JSON data
reference_data = response.json()

# Extract global variables and functions from the reference JSON
global_vars = set()
for entry in reference_data:
    if 'name' in entry:
        global_vars.add(entry['name'])

# Read the eslint.config.mjs file
with open(eslint_config_path, 'r', encoding='utf-8') as file:
    content = file.read()

# Extract existing globals
existing_globals = re.search(r'globals:\s*{([^}]*)}', content, re.DOTALL)
if existing_globals:
    existing_globals = existing_globals.group(1)
    existing_globals = set(re.findall(r'(\w+):\s*"readonly"', existing_globals))
else:
    existing_globals = set()

# Merge existing globals with new globals
merged_globals = existing_globals.union(global_vars)
merged_globals_list = sorted(merged_globals)

# Create new globals section
new_globals_section = 'globals: {\n' + ',\n'.join([f'  {var_name}: "readonly"' for var_name in merged_globals_list]) + '\n}'

# Update the globals section in the eslint.config.mjs file
globals_section_regex = re.compile(r'globals:\s*{[^}]*}', re.DOTALL)
updated_content = globals_section_regex.sub(new_globals_section, content)

# Write the updated content back to the eslint.config.mjs file
with open(eslint_config_path, 'w', encoding='utf-8') as file:
    file.write(updated_content)

print('eslint.config.mjs file updated successfully.')