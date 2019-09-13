#!/usr/bin/env python3

# LICENSE
# 
# _This file is Copyright 2018 by the Image Processing and Analysis Group (BioImage Suite Team). Dept. of Radiology & Biomedical Imaging, Yale School of Medicine._
# 
# BioImage Suite Web is licensed under the Apache License, Version 2.0 (the "License");
# 
# - you may not use this software except in compliance with the License.
# - You may obtain a copy of the License at [http://www.apache.org/licenses/LICENSE-2.0](http://www.apache.org/licenses/LICENSE-2.0)
# 
# __Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.__
# 
# ENDLICENSE

try:
    import bisweb_path;
except ImportError:
    bisweb_path=0;
    

import sys
import biswebpython.core.bis_basemodule as bis_basemodule
import biswebpython.core.bis_objects as bis_objects

class computeGLM(bis_basemodule.baseModule):

    def __init__(self):
        super().__init__();
        self.name='computeGLM';
   
    def createDescription(self):
        return self.getModuleDescriptionFromFile('computeGLM');

    def directInvokeAlgorithm(self,vals):
        print('oooo invoking: computeGLM with vals', vals);

        input = self.inputs['input'];
        mask  = self.inputs['mask']

        usemask=False;
        if (mask != None):
            usemask=True;
	    
        regressor = self.inputs['regressor'];
        sz=regressor.data_array.shape;
        numtasks=vals['numtasks'];
        if (numtasks<=0 or numtasks>=sz[1]):
            numtasks=sz[1];

        libbis=self.getDynamicLibraryWrapper();
        try:
            self.outputs['output'] = libbis.computeGLMWASM(input, mask, regressor, {
                'numtasks' : numtasks,
                'usemask' : usemask 
            }, self.parseBoolean(vals['debug']));
        except:
            print('---- Failed to invoke algorithm');
            return False

        return True

if __name__ == '__main__':
    import biswebpython.core.bis_commandline as bis_commandline;
    sys.exit(bis_commandline.loadParse(computeGLM(),sys.argv,False));
    
