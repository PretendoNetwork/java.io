export interface JavaClassDescriptionInfoField {
	type: string;
	name: string;
	class?: string;
}

export interface JavaClassDescriptionInfo {
	flags: {
		flags: number;
		strings: string[];
	};
	fields: JavaClassDescriptionInfoField[];
	superClass?: JavaClassDescription;
}

export interface JavaClassDescription {
	name: string;
	serialVersionUID: string;
	info: JavaClassDescriptionInfo;
	data: any; // * Can be an object, array, or Buffer
}

export interface JavaObject {
	class: JavaClassDescription | null;
}