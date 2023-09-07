import { StatusBar } from 'expo-status-bar';
import { ScrollView, Text, View, Pressable, TextInput } from 'react-native';
import WDILCard from './WDILCard';
import { localStorage } from './LocalStorage';
import { useState } from 'react';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { RootStackParams } from '../App';
import { CardType } from './types/CardType';

const CardCreationScreen = () => {

    const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();

    const [questionTextInput, setQuestionTextInput] = useState('');

    const handleSavePress = () => {
        //get current state
        const cardsCurrentState : Array<CardType> = JSON.parse(localStorage.getString('cards') ?? '[]');

        //calculate new id
        const newId = Math.max(...cardsCurrentState.map(card => card.id), -1) + 1;

        cardsCurrentState.push({
            id: newId,
            question: questionTextInput
        });

        //update storage
        localStorage.set('cards', JSON.stringify(cardsCurrentState));

        //navigate to home screen
        navigation.navigate('Home');
    }

    return (
		<View className="flex-1 justify-start bg-[#F5EFB9] py-3 px-4">
            <StatusBar style="auto" />

            <ScrollView>
                <Text className='text-gray-950 py-3 text-lg'>When did I last...</Text>
                <View className='flex flex-row items-center'>
                    <TextInput
                        className='bg-white rounded-l-md p-3 grow'
                        multiline={true}
                        numberOfLines={1}
                        autoCapitalize='none'
                        onChangeText={(text) => setQuestionTextInput(text)}
                    />
                    <Text className='bg-gray-100 rounded-r-md p-3 h-full text-xl'>?</Text>
                </View>

                <Pressable className='bg-[#82c056] rounded-md mt-4' onPress={handleSavePress}>
                    <Text className='text-white text-center py-3 text-lg'>Save</Text>
                </Pressable>
                
            </ScrollView>
			
		</View>
    );
};

export default CardCreationScreen;