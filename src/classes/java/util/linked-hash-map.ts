import { registerClass } from '@/java-object-input-stream';
import type JavaObjectInputStream from '@/java-object-input-stream';
import type { JavaClassDescription } from '@/types/java';

export default class LinkedHashMap {
	readObject(ois: JavaObjectInputStream, classDescription: JavaClassDescription) {
		ois.defaultReadObject(classDescription);

		// TODO - Is there more here...?
	}
}

registerClass('java.util.LinkedHashMap', LinkedHashMap);